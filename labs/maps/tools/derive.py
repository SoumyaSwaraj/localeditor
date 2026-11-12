#!/usr/bin/env python3
"""Derive the shipped maps models from the upstream files that scripts/fetch-maps-models.js downloads.

Needs: pip install onnx onnxruntime numpy
Usage:  python3 labs/maps/tools/derive.py <source-dir> <out-dir>

Two recipes, both lossless with respect to the upstream weights unless stated:

  fp16w   "weights-only fp16": every large float32 initializer is stored as float16 and a Cast(float32) node is put in
          front of its consumers. onnxruntime folds the Cast at load, so the graph runs in float32 on any CPU (the WASM
          build has no float16 kernels) and the file is half the size. MediaPipe's own .tflite files store float16
          weights, so for the face models this changes nothing: the float32 ONNX files made by tf2onnx hold the
          float16 values widened to float32.

  int8    onnxruntime dynamic quantisation (QUInt8 weights) of the ViT depth model, then the one big float constant
          (the interpolated position embedding) and the remaining float32 weights are stored as float16 as above.
          This is a lossy step: see docs/research/depth-face-maps.md for what it costs.
"""
import os, sys
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def fp16_weights(model, min_elems=512):
    g = model.graph
    consumers = {}
    for n in g.node:
        for i in n.input:
            consumers.setdefault(i, []).append(n)
    new_inits, casts = [], []
    for t in g.initializer:
        if t.data_type != TensorProto.FLOAT or int(np.prod(t.dims or [1])) < min_elems:
            new_inits.append(t)
            continue
        arr = numpy_helper.to_array(t)
        h = arr.astype(np.float16)
        if not np.isfinite(h).all():  # would overflow in fp16: leave as is
            new_inits.append(t)
            continue
        src = t.name + '__fp16'
        new_inits.append(numpy_helper.from_array(h, src))
        casts.append(helper.make_node('Cast', [src], [t.name], to=TensorProto.FLOAT, name='cast_' + t.name))
    del g.initializer[:]
    g.initializer.extend(new_inits)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(casts + nodes)  # casts first keeps the graph topologically sorted
    return model


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    jobs = [
        ('t9749/face_detector.onnx', 'face_detector.onnx'),
        ('t9749/face_landmarks_detector.onnx', 'face_landmarks.onnx'),
        ('t9749/face_blendshapes.onnx', 'face_blendshapes.onnx'),
        ('selfie/model.onnx', 'selfie_multiclass.onnx'),
    ]
    for a, b in jobs:
        p = os.path.join(src, a)
        if not os.path.exists(p):
            print('skip (missing)', p)
            continue
        m = fp16_weights(onnx.load(p))
        onnx.checker.check_model(m)
        onnx.save(m, os.path.join(out, b))
        print(b, os.path.getsize(os.path.join(out, b)))
    d = os.path.join(src, 'da2s/model.onnx')
    if os.path.exists(d):
        from onnxruntime.quantization import quantize_dynamic, QuantType
        tmp = os.path.join(out, '_da2s_int8_raw.onnx')
        quantize_dynamic(d, tmp, weight_type=QuantType.QUInt8, per_channel=False)
        m = fp16_weights(onnx.load(tmp), min_elems=256)
        onnx.save(m, os.path.join(out, 'depth_anything_v2_small_int8.onnx'))
        os.remove(tmp)
        print('depth_anything_v2_small_int8.onnx', os.path.getsize(os.path.join(out, 'depth_anything_v2_small_int8.onnx')))


if __name__ == '__main__':
    main()
