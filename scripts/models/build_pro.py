"""Build the three large background-remover models from their verified sources (called by scripts/fetch-models.js).

  python build_pro.py --src DIR_WITH_SOURCES --out assets/models/pro [--only birefnet-lite,birefnet,ben2] [--keep]

  birefnet-lite  BiRefNet-general-bb_swin_v1_tiny-epoch_232.pth -> export at 1024 (DeformConv, opset 20) -> onnxslim -> fp16
  birefnet       BiRefNet-general-epoch_244.pth                 -> export at 1024 (DeformConv, opset 20) -> onnxslim -> fp16
  ben2           BEN2_Base.onnx                                 -> unchanged (already a mixed fp16 graph at 1024)

onnxslim settings: --size-threshold 1000000 (do not fold the large Swin attention masks into weights) and
--skip-fusion-patterns FusionGemm (the backbone runs twice; Gemm fusion would duplicate its weights, +100 MB).
Tool versions are pinned in requirements.txt. Build-time only; nothing here runs in the browser.
"""
import argparse, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
SLIM = os.path.join(os.path.dirname(PY), 'onnxslim')

JOBS = {
    'birefnet-lite': ('BiRefNet-general-bb_swin_v1_tiny-epoch_232.pth', 'lite', 'birefnet-lite-1024-fp16.onnx'),
    'birefnet': ('BiRefNet-general-epoch_244.pth', 'full', 'birefnet-1024-fp16.onnx'),
    'ben2': ('BEN2_Base.onnx', None, 'ben2-1024-fp16.onnx'),
}


def step(*cmd):
    print('  $', ' '.join(os.path.basename(c) if os.path.isabs(c) and c.endswith('.py') else c for c in cmd), flush=True)
    subprocess.run(cmd, check=True)


def build(name, src_dir, out_dir, keep):
    src, variant, final = JOBS[name]
    src = os.path.join(src_dir, src)
    dst = os.path.join(out_dir, final)
    print(name, '->', dst, flush=True)
    if variant is None:
        shutil.copyfile(src, dst)
        return dst
    raw, slim = dst + '.raw.onnx', dst + '.slim.onnx'
    step(PY, os.path.join(HERE, 'export_birefnet.py'), '--variant', variant, '--weights', src, '--size', '1024', '--opset', '20', '--out', raw)
    step(SLIM, raw, slim, '--size-threshold', '1000000', '--skip-fusion-patterns', 'FusionGemm')
    step(PY, os.path.join(HERE, 'to_fp16.py'), slim, dst)
    if not keep:
        for f in (raw, slim):
            os.remove(f)
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default=','.join(JOBS))
    ap.add_argument('--keep', action='store_true', help='keep the fp32 intermediates (raw and slimmed)')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for name in [x for x in a.only.split(',') if x]:
        build(name, a.src, a.out, a.keep)


if __name__ == '__main__':
    main()
