/** Worker details remain in the console. The opening panel explains recovery. */
export function modelOpeningErrorMessage(detail: string): string {
  if (/file format is not supported|not a blend file/i.test(detail))
    return 'This file is not a supported Blender model. Choose a valid .blend file or return to the previous model.';
  if (/EACCES|permission denied|read-only file system/i.test(detail))
    return 'Blender could not access the model file. Check its file permissions, then try again.';
  if (/ENOENT|no such file|file not found/i.test(detail))
    return 'The model file could not be found. Check that it still exists, or return to the previous model.';
  if (/failed to fetch|networkerror|network error/i.test(detail))
    return 'Blender could not finish loading. Check your connection, then try again.';
  return 'Blender could not open this model. Try again, or return to the previous model. Details are available in the console.';
}
