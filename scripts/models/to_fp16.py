"""Convert an fp32 ONNX graph to fp16 weights and compute for the WebGPU runtime (needs the adapter feature 'shader-f16').

  python to_fp16.py in.onnx out.onnx

Inputs and outputs stay float32 (keep_io_types), so the page code does not change. Build-time only.
(BEN2's published BEN2_Base.onnx is already a mixed fp16 graph and is shipped unchanged; this is for BiRefNet.)
"""
import sys

import onnx
from onnxconverter_common import float16

# DeformConv: no fp16 kernel in onnxruntime (the WebGPU provider hands it to the CPU side, in fp32, either way).
BLOCK = ['DeformConv']


def main(src, dst):
    m = onnx.load(src)
    m16 = float16.convert_float_to_float16(m, keep_io_types=True, op_block_list=BLOCK)
    onnx.save(m16, dst)
    print('wrote', dst)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
