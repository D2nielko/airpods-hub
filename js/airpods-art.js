/**
 * Inline SVG artwork for AirPods models — drawn art, no Apple assets.
 *
 * AirPodsArt.render(family, part) -> svg string
 *   family: 'pro' | 'classic' | 'max'
 *   part:   'left' | 'right' | 'case'
 *
 * Left and right earbuds are mirror images; the right is the drawn shape,
 * the left is flipped with a transform.
 */
const AirPodsArt = (() => {
  const defs = (id) => `
    <defs>
      <linearGradient id="body-${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fdfdfd"/>
        <stop offset="1" stop-color="#d6d6db"/>
      </linearGradient>
      <linearGradient id="shade-${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e9e9ee"/>
        <stop offset="1" stop-color="#c2c2c8"/>
      </linearGradient>
    </defs>`;

  const STROKE = 'stroke="#a9a9b0" stroke-width="1.5"';

  /* ---- earbuds (drawn as RIGHT pod, tip pointing left) ---- */

  const proPod = (id) => `
    ${defs(id)}
    <rect x="38" y="44" width="15" height="50" rx="7.5" fill="url(#shade-${id})" ${STROKE}/>
    <ellipse cx="42" cy="32" rx="21" ry="23" fill="url(#body-${id})" ${STROKE}/>
    <ellipse cx="24" cy="26" rx="10" ry="13" fill="#d8d8dd" ${STROKE}/>
    <ellipse cx="20" cy="26" rx="5" ry="8.5" fill="#3a3a3c"/>
    <ellipse cx="50" cy="22" rx="6" ry="8" fill="#ffffff" opacity="0.7"/>
    <circle cx="56" cy="36" r="2.2" fill="#8e8e93"/>`;

  const classicPod = (id) => `
    ${defs(id)}
    <rect x="36" y="38" width="14" height="58" rx="7" fill="url(#shade-${id})" ${STROKE}/>
    <ellipse cx="40" cy="26" rx="19" ry="20" fill="url(#body-${id})" ${STROKE}/>
    <ellipse cx="24" cy="22" rx="8" ry="11" fill="#c7c7cc" ${STROKE}/>
    <ellipse cx="22" cy="22" rx="4" ry="7" fill="#8e8e93"/>
    <ellipse cx="47" cy="17" rx="5.5" ry="7" fill="#ffffff" opacity="0.7"/>
    <circle cx="43" cy="93" r="2.2" fill="#8e8e93"/>`;

  const maxCup = (id) => `
    ${defs(id)}
    <rect x="34" y="4" width="12" height="26" rx="6" fill="url(#shade-${id})" ${STROKE}/>
    <ellipse cx="40" cy="58" rx="26" ry="32" fill="url(#body-${id})" ${STROKE}/>
    <ellipse cx="40" cy="58" rx="17" ry="23" fill="#48484a"/>
    <ellipse cx="40" cy="58" rx="11" ry="16" fill="#2c2c2e"/>`;

  /* ---- cases ---- */

  const proCase = (id) => `
    ${defs(id)}
    <rect x="8" y="12" width="94" height="70" rx="20" fill="url(#body-${id})" ${STROKE}/>
    <path d="M8 40 H102" stroke="#b3b3ba" stroke-width="2.5" fill="none"/>
    <path d="M8 44 H102" stroke="#ffffff" stroke-width="1" opacity="0.6" fill="none"/>
    <circle cx="55" cy="58" r="3.2" fill="#8e8e93"/>`;

  const classicCase = (id) => `
    ${defs(id)}
    <rect x="20" y="6" width="58" height="92" rx="16" fill="url(#body-${id})" ${STROKE}/>
    <path d="M20 42 H78" stroke="#b3b3ba" stroke-width="2.5" fill="none"/>
    <path d="M20 46 H78" stroke="#ffffff" stroke-width="1" opacity="0.6" fill="none"/>
    <circle cx="49" cy="62" r="3.2" fill="#8e8e93"/>`;

  const maxCase = (id) => `
    ${defs(id)}
    <path d="M14 36 a18 18 0 0 1 18-18 h46 a18 18 0 0 1 18 18 v28 a18 18 0 0 1 -18 18 h-46 a18 18 0 0 1 -18-18 z"
      fill="url(#body-${id})" ${STROKE}/>
    <path d="M40 18 v64 M70 18 v64" stroke="#b3b3ba" stroke-width="2" fill="none"/>
    <circle cx="55" cy="50" r="3.2" fill="#8e8e93"/>`;

  const ART = {
    pro:     { pod: proPod,     case: proCase,     viewPod: '0 0 80 100', viewCase: '0 0 110 94' },
    classic: { pod: classicPod, case: classicCase, viewPod: '0 0 80 100', viewCase: '0 0 98 104' },
    max:     { pod: maxCup,     case: maxCase,     viewPod: '0 0 80 100', viewCase: '0 0 110 94' },
  };

  function render(family, part) {
    const art = ART[family] || ART.classic;
    const id = `${family}-${part}`;
    if (part === 'case') {
      return `<svg viewBox="${art.viewCase}" xmlns="http://www.w3.org/2000/svg" role="img">${art.case(id)}</svg>`;
    }
    const flip = part === 'left' ? ' style="transform:scaleX(-1)"' : '';
    return `<svg viewBox="${art.viewPod}" xmlns="http://www.w3.org/2000/svg" role="img"${flip}>${art.pod(id)}</svg>`;
  }

  return { render };
})();
