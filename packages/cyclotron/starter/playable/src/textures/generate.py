# SPDX-License-Identifier: MIT
# Copyright 2026 Volter AI, Inc.
# Deterministic procedural surface textures; no reference pixels are used.
import numpy as np
from PIL import Image, ImageFilter
from pathlib import Path
rng=np.random.default_rng(19);root=Path(__file__).parent
N=1024
def noise(size,w,h):
 a=rng.random((h,w)).astype('float32');im=Image.fromarray((a*255).astype('uint8')).resize((size,size),Image.Resampling.BICUBIC);return np.asarray(im)/255-.5
n=noise(N,256,256)*.20+noise(N,650,650)*.19+noise(N,30,30)*.06
base=np.array([104,104,96]);out=np.clip(base+n[:,:,None]*255,0,255).astype('uint8');Image.fromarray(out).save(root/'asphalt.png')
y=np.arange(N)[:,None];x=np.arange(N)[None,:];warp=np.sin(x*.009)*3+np.sin(x*.032)*1.2
bands=np.sin((y+warp)*.075)*.05+np.sin((y+warp)*.28)*.035+np.sin((y+warp)*1.1)*.02
n=noise(N,20,90)*.16+noise(N,150,500)*.11+bands
base=np.array([211,124,79]);out=np.clip(base+n[:,:,None]*np.array([220,180,120]),0,255).astype('uint8');Image.fromarray(out).save(root/'sandstone.png')
