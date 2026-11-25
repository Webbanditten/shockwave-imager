import { fourCC } from '../io/binary-reader';

/** Container signatures */
export const FOURCC_RIFX = fourCC('RIFX');
export const FOURCC_XFIR = fourCC('XFIR');

/** Codec identifiers */
export const FOURCC_MV93 = fourCC('MV93'); // Director movie (uncompressed)
export const FOURCC_MC95 = fourCC('MC95'); // Director cast (uncompressed)
export const FOURCC_FGDM = fourCC('FGDM'); // Afterburner movie (.dcr)
export const FOURCC_FGDC = fourCC('FGDC'); // Afterburner cast (.cct)

/** Afterburner chunks */
export const FOURCC_Fver = fourCC('Fver');
export const FOURCC_Fcdr = fourCC('Fcdr');
export const FOURCC_ABMP = fourCC('ABMP');
export const FOURCC_FGEI = fourCC('FGEI');

/** Memory map (uncompressed) */
export const FOURCC_imap = fourCC('imap');
export const FOURCC_mmap = fourCC('mmap');
export const FOURCC_free = fourCC('free');
export const FOURCC_junk = fourCC('junk');

/** Config */
export const FOURCC_DRCF = fourCC('DRCF');
export const FOURCC_VWCF = fourCC('VWCF');

/** Cast management */
export const FOURCC_MCsL = fourCC('MCsL');
export const FOURCC_CASp = fourCC('CAS*');
export const FOURCC_CASt = fourCC('CASt');
export const FOURCC_KEYp = fourCC('KEY*');
export const FOURCC_Cinf = fourCC('Cinf');

/** Scripts */
export const FOURCC_Lctx = fourCC('Lctx');
export const FOURCC_LctX = fourCC('LctX');
export const FOURCC_Lnam = fourCC('Lnam');
export const FOURCC_Lscr = fourCC('Lscr');

/** Score/timeline */
export const FOURCC_VWSC = fourCC('VWSC');
export const FOURCC_SCVW = fourCC('SCVW');
export const FOURCC_VWLB = fourCC('VWLB');
export const FOURCC_Sord = fourCC('Sord');

/** Media */
export const FOURCC_BITD = fourCC('BITD');
export const FOURCC_ALFA = fourCC('ALFA');
export const FOURCC_CLUT = fourCC('CLUT');
export const FOURCC_STXT = fourCC('STXT');
export const FOURCC_snd = fourCC('snd ');
export const FOURCC_ediM = fourCC('ediM');
export const FOURCC_XMED = fourCC('XMED');
export const FOURCC_Fmap = fourCC('Fmap');
export const FOURCC_Thum = fourCC('Thum');
export const FOURCC_FXmp = fourCC('FXmp');
