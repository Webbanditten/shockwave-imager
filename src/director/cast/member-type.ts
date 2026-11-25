/** Director cast member types (CASt chunk type codes). */
export enum MemberType {
  Null = 0,
  Bitmap = 1,
  FilmLoop = 2,
  Text = 3, // fields
  Palette = 4,
  Picture = 5,
  Sound = 6,
  Button = 7,
  Shape = 8,
  Movie = 9,
  DigitalVideo = 10,
  Script = 11,
  RichText = 12,
  Transition = 14,
  Xtra = 15,
  Font = 16,
  Shockwave3D = 17,
  Unknown = 255,
}

export function memberTypeFromCode(code: number): MemberType {
  return code in MemberType ? (code as MemberType) : MemberType.Unknown;
}

export function memberTypeName(type: MemberType): string {
  const names: Record<number, string> = {
    [MemberType.Null]: 'null',
    [MemberType.Bitmap]: 'bitmap',
    [MemberType.FilmLoop]: 'filmLoop',
    [MemberType.Text]: 'field',
    [MemberType.Palette]: 'palette',
    [MemberType.Picture]: 'picture',
    [MemberType.Sound]: 'sound',
    [MemberType.Button]: 'button',
    [MemberType.Shape]: 'shape',
    [MemberType.Movie]: 'movie',
    [MemberType.DigitalVideo]: 'digitalVideo',
    [MemberType.Script]: 'script',
    [MemberType.RichText]: 'text',
    [MemberType.Transition]: 'transition',
    [MemberType.Xtra]: 'xtra',
    [MemberType.Font]: 'font',
    [MemberType.Shockwave3D]: 'shockwave3d',
  };
  return names[type] ?? 'unknown';
}
