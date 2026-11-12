import numpy as np, onnxruntime as ort
from PIL import Image
from ai_edge_litert.interpreter import Interpreter
import sys, os
# usage: python3 verify_face.py <dir with mp/task/*.tflite, mp/selfie_multiclass.tflite, t9749/*.onnx, selfie/model.onnx> <photo.jpg>
# Needs: pip install onnxruntime ai-edge-litert numpy pillow. Proves the third-party ONNX files equal Google's tflite files.
S = sys.argv[1].rstrip('/') + '/'
PHOTO = sys.argv[2]
def tfl(p):
    it = Interpreter(model_path=p); it.allocate_tensors(); return it
def runtfl(it, x):
    d = it.get_input_details()[0]; it.set_tensor(d['index'], x.astype(d['dtype'])); it.invoke()
    return [it.get_tensor(o['index']).copy() for o in it.get_output_details()]
def info(it):
    print('  tflite in', [(d['shape'].tolist(), d['dtype'].__name__) for d in it.get_input_details()], 'out', [(d['name'], d['shape'].tolist()) for d in it.get_output_details()])
im = Image.open(PHOTO).convert('RGB')
# detector
x = np.asarray(im.resize((128, 128), Image.BILINEAR), 'f4')[None] / 127.5 - 1.0
t = tfl(S + 'mp/task/face_detector.tflite'); info(t)
o = ort.InferenceSession(S + 't9749/face_detector.onnx')
to = runtfl(t, x); oo = o.run(None, {o.get_inputs()[0].name: x})
for a, b, n in zip(to, oo, ['regressors', 'scores']):
    pass
print('detector outs tflite', [a.shape for a in to], 'onnx', [a.shape for a in oo])
for a in to:
    m = [b for b in oo if b.shape == a.shape]
    if m: print('  max abs diff', a.shape, np.abs(a - m[0]).max(), 'range', a.min(), a.max())
# landmarks
x = np.asarray(im.crop((330, 20, 500, 190)).resize((256, 256), Image.BILINEAR), 'f4')[None] / 255.0
t = tfl(S + 'mp/task/face_landmarks_detector.tflite'); info(t)
o = ort.InferenceSession(S + 't9749/face_landmarks_detector.onnx')
to = runtfl(t, x); oo = o.run(None, {o.get_inputs()[0].name: x})
for a in to:
    m = [b for b in oo if b.size == a.size]
    for b in m: print('  landmark out', a.shape, b.shape, 'max abs diff', np.abs(a.reshape(-1) - b.reshape(-1)).max(), 'val', a.reshape(-1)[:3])
# blendshapes
t = tfl(S + 'mp/task/face_blendshapes.tflite'); info(t)
o = ort.InferenceSession(S + 't9749/face_blendshapes.onnx')
x = (np.random.RandomState(1).rand(1, 146, 2) * 256).astype('f4')
to = runtfl(t, x); oo = o.run(None, {o.get_inputs()[0].name: x})
print('  blend max abs diff', np.abs(to[0].reshape(-1) - oo[0].reshape(-1)).max())
# selfie
t = tfl(S + 'mp/selfie_multiclass.tflite'); info(t)
o = ort.InferenceSession(S + 'selfie/model.onnx')
x = np.asarray(im.resize((256, 256), Image.BILINEAR), 'f4')[None] / 255.0
to = runtfl(t, x); oo = o.run(None, {o.get_inputs()[0].name: x})
print('  selfie out', to[0].shape, oo[0].shape, 'max abs diff', np.abs(to[0] - oo[0]).max(), 'argmax agree', (to[0].argmax(-1) == oo[0].argmax(-1)).mean())
