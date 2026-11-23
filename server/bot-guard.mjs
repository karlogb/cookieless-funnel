// Optional contact-form bot guard.
//
// The client script adds two hidden fields to forms marked with data-guard:
//   fe = milliseconds between page load and submit
//   fi = "1" if any field in the form received focus, otherwise "0"
// Scripts that POST directly to the form endpoint usually send neither. Add a
// honeypot field (hidden from humans with CSS) for the simplest crawlers.
// Recommended handling of a failed check: answer exactly like a success (so the
// bot learns nothing) and file the submission separately instead of notifying.

/**
 * @param {URLSearchParams|Record<string,string>} form submitted fields
 * @param {object} [opts] { minMs = 3000, honeypot = 'website' }
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkForm(form, opts = {}) {
  const minMs = opts.minMs ?? 3000;
  const honeypot = opts.honeypot ?? 'website';
  const get = (k) => (typeof form?.get === 'function' ? form.get(k) : form?.[k]) ?? null;

  if (honeypot && String(get(honeypot) ?? '').trim()) return { ok: false, reason: 'honeypot' };
  const fe = get('fe'), fi = get('fi');
  if (fe === null || fi === null) return { ok: false, reason: 'missing_guard_fields' };
  if (fi !== '1') return { ok: false, reason: 'no_field_focus' };
  const ms = Number(fe);
  if (!Number.isFinite(ms) || ms < minMs) return { ok: false, reason: 'too_fast' };
  return { ok: true, reason: '' };
}
