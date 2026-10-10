import { groupLivePhotoFiles } from '../livePhotos';
const file = (name: string) => new File(['data'], name);
it('pairs a photo and MOV regardless of selection order and letter case', () => {
  const photo = file('IMG_1234.HEIC'); const motion = file('img_1234.mov');
  expect(groupLivePhotoFiles([motion, photo])).toEqual([{ file: photo, motionFile: motion }]);
});
it('keeps ambiguous and unrelated files separate', () => {
  const files = ['IMG_1234.HEIC', 'IMG_1234.JPG', 'IMG_1234.MOV', 'IMG_5678.MOV'].map(file);
  expect(groupLivePhotoFiles(files)).toEqual(files.map((file) => ({ file })));
});
