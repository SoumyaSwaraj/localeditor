#!/usr/bin/env python3
"""Optional smaller depth variant: 4-bit weights for the transformer MatMuls (MatMulNBits, block 64), 8-bit for the DPT head
convolutions, float16-stored constants. Usage: python3 derive_q4.py <da2s/model.onnx> <out.onnx>
Needs onnxruntime >= 1.18 (python) to write the file; onnxruntime-web 1.22 reads MatMulNBits."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import onnx
from derive import fp16_weights

src, out = sys.argv[1], sys.argv[2]
from onnxruntime.quantization import quantize_dynamic, QuantType
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
model = onnx.load(src)
q = MatMulNBitsQuantizer(model, bits=4, block_size=64, is_symmetric=True, accuracy_level=0)
q.process()
tmp = out + '.tmp.onnx'
q.model.save_model_to_file(tmp, True)
quantize_dynamic(tmp, out + '.tmp2.onnx', weight_type=QuantType.QUInt8, op_types_to_quantize=['Conv'])
m = fp16_weights(onnx.load(out + '.tmp2.onnx'), min_elems=256)
onnx.save(m, out)
os.remove(tmp)
os.remove(out + '.tmp2.onnx')
print(out, os.path.getsize(out))
