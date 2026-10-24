import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImageType, validateImageFile, validateImageDimensions, imageHeaderDimensions, normalizeCrop } from '../public/image-input.mjs';

const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,16,0,0,0,24]);
test('only PNG and JPEG signatures are accepted, independently of filename', () => {
  assert.equal(detectImageType(png), 'image/png');
  assert.equal(detectImageType(new Uint8Array([255,216,255,224])), 'image/jpeg');
  assert.equal(detectImageType(new TextEncoder().encode('<svg></svg>')), null);
  assert.equal(detectImageType(png.subarray(0, 6)), null);
  assert.equal(validateImageFile({size:10*1024*1024}, png), 'image/png');
  assert.throws(() => validateImageFile({size:10*1024*1024+1}, png), /10 MiB/);
  assert.throws(() => validateImageFile({size:0}, png), /空/);
  assert.throws(() => validateImageFile({size:32}, new Uint8Array(32)), /PNG.*JPEG/);
});
test('header dimensions reject excessive original pixels before decoding', () => {
  assert.deepEqual(imageHeaderDimensions(png), {width:16,height:24});
  const jpeg = new Uint8Array([255,216,255,224,0,4,0,0,255,192,0,11,8,0,24,0,16,1,1,17,0]);
  assert.deepEqual(imageHeaderDimensions(jpeg), {width:16,height:24});
  assert.deepEqual(validateImageDimensions(4000,4000), {width:4000,height:4000});
  assert.throws(() => validateImageDimensions(4001,4000), /1600/);
  assert.throws(() => validateImageDimensions(0,8), /尺寸/);
  assert.throws(() => validateImageDimensions(Infinity,8), /尺寸/);
  assert.throws(() => imageHeaderDimensions(jpeg.subarray(0,14)), /损坏|完整/);
});
test('crop coordinates are integer, bounded, nonempty and orientation follows decoded size', () => {
  assert.deepEqual(normalizeCrop({x:-3,y:5.7,width:500,height:12},100,80), {x:0,y:6,width:100,height:12});
  assert.deepEqual(normalizeCrop({x:99,y:79,width:0,height:-2},100,80), {x:99,y:79,width:1,height:1});
  assert.equal(normalizeCrop(null,100,80), null);
  assert.throws(() => normalizeCrop({x:NaN,y:0,width:2,height:2},100,80), /裁剪/);
});
