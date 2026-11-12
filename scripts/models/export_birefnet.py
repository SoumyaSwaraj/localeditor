"""Re-export BiRefNet (MIT, github.com/ZhengPeng7/BiRefNet) from its released PyTorch weights to a browser-friendly ONNX graph.

Why not use the released .onnx files: they were exported with a GatherND decomposition of deformable convolution
(opset 17), which needs about 12 GB of working memory at 1024 px. This export uses the ONNX DeformConv operator
(opset 19+), which onnxruntime 1.31 implements natively, and fixes the input size so every shape is static.

  python export_birefnet.py --variant lite|full --weights BiRefNet-...pth --size 1024 --out model.onnx

The model definition is scripts/models/birefnet_arch.py (a trimmed copy of the upstream file, MIT).
Build-time only: nothing in this folder runs in the browser.
"""
import argparse, os, re, sys

import torch
import torch.nn as nn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import birefnet_arch as arch  # noqa: E402


def deform_conv2d_symbolic(g, inp, weight, offset, mask, bias, stride_h, stride_w, pad_h, pad_w, dil_h, dil_w,
                           n_weight_grps, n_offset_grps, use_mask):
    """torchvision::deform_conv2d -> ONNX DeformConv (opset 19): X, W, offset, B, mask."""
    from torch.onnx import symbolic_helper as sh
    sh_i = lambda v: sh._get_const(v, 'i', 'int')  # noqa: E731
    k = sh._get_tensor_sizes(weight)[2:]
    ph, pw = sh_i(pad_h), sh_i(pad_w)
    args = [inp, weight, offset, bias]
    if sh._maybe_get_const(use_mask, 'b'):
        args.append(mask)
    return g.op('DeformConv', *args, kernel_shape_i=k, strides_i=[sh_i(stride_h), sh_i(stride_w)],
                pads_i=[ph, pw, ph, pw], dilations_i=[sh_i(dil_h), sh_i(dil_w)],
                group_i=sh_i(n_weight_grps), offset_group_i=sh_i(n_offset_grps))


def load_model(variant, weights):
    arch.BB_INDEX = {'lite': 3, 'full': 6}[variant]
    model = arch.BiRefNet(bb_pretrained=False)
    sd = torch.load(weights, map_location='cpu', weights_only=True)
    if isinstance(sd, dict) and 'state_dict' in sd:
        sd = sd['state_dict']
    sd = {re.sub(r'^(module\.|_orig_mod\.)+', '', k): v for k, v in sd.items()}
    missing, unexpected = model.load_state_dict(sd, strict=False)
    if missing or unexpected:
        raise SystemExit('weights do not match the model: missing %s unexpected %s' % (missing[:5], unexpected[:5]))
    return model.eval()


class Wrapped(nn.Module):
    """Input: float32 [1,3,S,S], ImageNet-normalised RGB. Output: [1,1,S,S] probabilities (sigmoid applied)."""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        return self.m(x)[-1].sigmoid()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--variant', choices=['lite', 'full'], required=True)
    ap.add_argument('--weights', required=True)
    ap.add_argument('--size', type=int, default=1024)
    ap.add_argument('--opset', type=int, default=20)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    if a.size % 32:
        raise SystemExit('--size must be a multiple of 32')
    model = Wrapped(load_model(a.variant, a.weights))
    x = torch.zeros(1, 3, a.size, a.size)
    torch.onnx.register_custom_op_symbolic('torchvision::deform_conv2d', deform_conv2d_symbolic, 19)
    with torch.no_grad():
        torch.onnx.export(model, (x,), a.out, input_names=['input_image'], output_names=['output_image'],
                          opset_version=a.opset, do_constant_folding=True, dynamo=False)
    print('wrote', a.out, os.path.getsize(a.out))


if __name__ == '__main__':
    main()
