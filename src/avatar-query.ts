/** /avatar query -> options, with the CMS's (Avatara's) parameter names: size b|s|l, direction, head_direction, action
 *  (std, wlk, sit, lay, wav, spk, crr, drk; comma separated), gesture (sml, sad, agr, srp), crr / drk (hand item),
 *  frame (1-based), head=1, dance (1-4), anim=1 (animated: dances always, else walking, waving, talking). */
import type { AvatarOptions } from './avatar';

export function avatarOptions(q: URLSearchParams): AvatarOptions & { size: string } {
  const num = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(q.get(k));
    return q.has(k) && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : d;
  };
  const actions = (q.get('action') ?? 'std').toLowerCase().split(',').map((a) => a.trim());
  const size = ['b', 's', 'l'].includes(q.get('size') ?? '') ? q.get('size')! : 'b';
  const direction = num('direction', 2, 0, 7);
  const o: AvatarOptions & { size: string } = {
    size,
    direction,
    headDirection: num('head_direction', direction, 0, 7),
    action: actions.find((a) => ['wlk', 'sit', 'lay'].includes(a)) ?? 'std',
    wave: actions.includes('wav') || actions.includes('wave'),
    talk: actions.includes('spk') || actions.includes('talk'),
    gesture: ['sml', 'sad', 'agr', 'srp', 'spr'].includes(q.get('gesture') ?? '') ? q.get('gesture')! : undefined,
    frame: num('frame', 1, 1, 1000) - 1,
    headOnly: q.get('head') === '1' || q.get('head') === 'true',
    dance: num('dance', 0, 0, 4) || undefined,
    anim: q.get('anim') === '1' || q.get('anim') === 'true',
  };
  const item = (k: string) => {
    const v = Number(q.get(k));
    return Number.isFinite(v) && v > 0 ? Math.trunc(v) : undefined;
  };
  // Avatara: drk=1 (or true) drinks the crr item; drk=<n> drinks item n; crr=<n> alone carries it.
  const drk = q.get('drk');
  if (actions.includes('drk') || drk === '1' || drk === 'true') o.drink = item('crr') ?? 1;
  else if (item('drk') !== undefined) o.drink = item('drk');
  else if (item('crr') !== undefined || actions.includes('crr')) o.carry = item('crr') ?? 1;
  return o;
}
