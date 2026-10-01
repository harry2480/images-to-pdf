# Convert Real-ESRGAN realesr-general-x4v3 (+ wdn variant, DNI-interpolated) to ONNX.
# Weights: https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0 (BSD-3-Clause)
# Usage: put both .pth files next to this script, then `pip install torch onnx onnxruntime && python convert-realesrgan.py`
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
import onnxruntime as ort


class SRVGGNetCompact(nn.Module):
    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4):
        super().__init__()
        self.upscale = upscale
        self.body = nn.ModuleList()
        self.body.append(nn.Conv2d(num_in_ch, num_feat, 3, 1, 1))
        self.body.append(nn.PReLU(num_parameters=num_feat))
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat))
        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        out = self.upsampler(out)
        return out + F.interpolate(x, scale_factor=self.upscale, mode='nearest')


def load(path):
    sd = torch.load(path, map_location='cpu', weights_only=True)
    return sd.get('params_ema', sd.get('params', sd))


strong = load('realesr-general-x4v3.pth')
weak = load('realesr-general-wdn-x4v3.pth')

# Same DNI as Real-ESRGAN's inference script: s * x4v3 + (1 - s) * wdn.
for label, s in [('weak', 0.0), ('medium', 0.5), ('strong', 1.0)]:
    sd = {k: s * strong[k] + (1 - s) * weak[k] for k in strong}
    m = SRVGGNetCompact().eval()
    m.load_state_dict(sd, strict=True)
    x = torch.rand(1, 3, 64, 80)
    out_path = f'realesr-general-x4v3-dn-{label}.onnx'
    torch.onnx.export(
        m, x, out_path, input_names=['input'], output_names=['output'], opset_version=17,
        dynamic_axes={'input': {2: 'h', 3: 'w'}, 'output': {2: 'h4', 3: 'w4'}}, dynamo=False,
    )
    with torch.no_grad():
        ref = m(x).numpy()
    sess = ort.InferenceSession(out_path, providers=['CPUExecutionProvider'])
    got = sess.run(None, {'input': x.numpy()})[0]
    x2 = torch.rand(1, 3, 37, 51)
    got2 = sess.run(None, {'input': x2.numpy()})[0]
    with torch.no_grad():
        ref2 = m(x2).numpy()
    print(label, out_path, got.shape, float(np.abs(ref - got).max()), got2.shape, float(np.abs(ref2 - got2).max()))
