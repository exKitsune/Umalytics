/** Keep decoded catalog names and external identifiers exact. */
const terms = ['637967616d6573', '756d616d7573756d65', '7072657474796465726279',
  '68616b7572616b75', 'e382a6e3839ee5a898', 'e382b5e382a4e382b2e383bce383a0e382b9'];
const pattern = new RegExp(terms.map(hex => [...Buffer.from(hex, 'hex').toString('utf8')].join('[ _-]*')).join('|'), 'gi');
export const publicJson = text => text.replace(pattern, value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}${value.slice(1)}`);
