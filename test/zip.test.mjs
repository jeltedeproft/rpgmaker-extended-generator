import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipFiles, unzip } from '../src/zip.js';

test('a zip we write reads back the same', async () => {
  const files = [{ name: 'Pack/Face/ä.png', bytes: new Uint8Array([137, 80, 78, 71]) }, { name: 'setup.json', bytes: new TextEncoder().encode('{}') }];
  const back = await unzip(zipFiles(files));
  assert.deepEqual(back.map((f) => [f.name, [...f.bytes]]), files.map((f) => [f.name, [...f.bytes]]));
});

test('zips made elsewhere: deflated files are unpacked, folders and __MACOSX left out', async () => {
  // Made with Python's zipfile (ZIP_DEFLATED): "Pack/", "Pack/a.txt", "__MACOSX/Pack/._a.txt".
  const zip = Uint8Array.from(atob('UEsDBBQAAAAIAPdBe10AAAAAAgAAAAAAAAAFAAAAUGFjay8DAFBLAwQUAAAACAD3QXtd41E9jQoAAAAXAAAACgAAAFBhY2svYS50eHTLSM3JyVfIQCcBUEsDBBQAAAAIAPdBe105nPsGBgAAAAQAAAAVAAAAX19NQUNPU1gvUGFjay8uX2EudHh0yyrNywYAUEsBAhQAFAAAAAgA90F7XQAAAAACAAAAAAAAAAUAAAAAAAAAAAAQAP1BAAAAAFBhY2svUEsBAhQAFAAAAAgA90F7XeNRPY0KAAAAFwAAAAoAAAAAAAAAAAAAAIABJQAAAFBhY2svYS50eHRQSwECFAAUAAAACAD3QXtdOZz7BgYAAAAEAAAAFQAAAAAAAAAAAAAAgAFXAAAAX19NQUNPU1gvUGFjay8uX2EudHh0UEsFBgAAAAADAAMArgAAAJAAAAAAAA=='), (c) => c.charCodeAt(0));
  const files = await unzip(zip);
  assert.deepEqual(files.map((f) => [f.name, new TextDecoder().decode(f.bytes)]), [['Pack/a.txt', 'hello hello hello hello']]);
  await assert.rejects(unzip(new Uint8Array(40)), /not a zip/);
});
