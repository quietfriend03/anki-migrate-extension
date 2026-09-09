/**
 * Japanese Inflection / Deinflector Engine for J-Lexicon AI
 * Converts inflected Japanese verb/adjective forms back to dictionary forms.
 */

const DEINFLECTION_RULES = [
  // Polite past: ました -> ます -> dictionary
  { suffix: 'ませんでした', replacement: 'る', desc: 'polite negative past' },
  { suffix: 'ませんでした', replacement: '', desc: 'polite negative past stem' },
  { suffix: 'ました', replacement: 'る', desc: 'polite past (ichidan)' },
  { suffix: 'ました', replacement: '', desc: 'polite past stem' },
  { suffix: 'ません', replacement: 'る', desc: 'polite negative (ichidan)' },
  { suffix: 'ません', replacement: '', desc: 'polite negative stem' },

  // Masu-stem conversions for godan
  { suffix: 'きます', replacement: 'く', desc: 'polite (godan k)' },
  { suffix: 'ぎます', replacement: 'ぐ', desc: 'polite (godan g)' },
  { suffix: 'します', replacement: 'す', desc: 'polite (godan s)' },
  { suffix: 'します', replacement: 'する', desc: 'polite (suru)' },
  { suffix: 'ちます', replacement: 'つ', desc: 'polite (godan t)' },
  { suffix: 'にます', replacement: 'ぬ', desc: 'polite (godan n)' },
  { suffix: 'みます', replacement: 'む', desc: 'polite (godan m)' },
  { suffix: 'ります', replacement: 'る', desc: 'polite (godan r)' },
  { suffix: 'います', replacement: 'う', desc: 'polite (godan u)' },
  { suffix: 'きます', replacement: 'くる', desc: 'polite (kuru)' },
  { suffix: 'ます', replacement: 'る', desc: 'polite (ichidan)' },

  // Past: た / だ
  { suffix: 'いた', replacement: 'く', desc: 'past (godan k)' },
  { suffix: 'いだ', replacement: 'ぐ', desc: 'past (godan g)' },
  { suffix: 'した', replacement: 'す', desc: 'past (godan s)' },
  { suffix: 'った', replacement: 'う', desc: 'past (godan u)' },
  { suffix: 'った', replacement: 'つ', desc: 'past (godan t)' },
  { suffix: 'った', replacement: 'る', desc: 'past (godan r)' },
  { suffix: 'んだ', replacement: 'む', desc: 'past (godan m)' },
  { suffix: 'んだ', replacement: 'ぶ', desc: 'past (godan b)' },
  { suffix: 'んだ', replacement: 'ぬ', desc: 'past (godan n)' },
  { suffix: 'いった', replacement: 'いく', desc: 'past (iku)' },
  { suffix: 'きた', replacement: 'くる', desc: 'past (kuru)' },
  { suffix: 'た', replacement: 'る', desc: 'past (ichidan)' },

  // Te-form: て / で
  { suffix: 'いて', replacement: 'く', desc: 'te-form (godan k)' },
  { suffix: 'いで', replacement: 'ぐ', desc: 'te-form (godan g)' },
  { suffix: 'して', replacement: 'す', desc: 'te-form (godan s)' },
  { suffix: 'して', replacement: 'する', desc: 'te-form (suru)' },
  { suffix: 'って', replacement: 'う', desc: 'te-form (godan u)' },
  { suffix: 'って', replacement: 'つ', desc: 'te-form (godan t)' },
  { suffix: 'って', replacement: 'る', desc: 'te-form (godan r)' },
  { suffix: 'んで', replacement: 'む', desc: 'te-form (godan m)' },
  { suffix: 'んで', replacement: 'ぶ', desc: 'te-form (godan b)' },
  { suffix: 'んで', replacement: 'ぬ', desc: 'te-form (godan n)' },
  { suffix: 'いって', replacement: 'いく', desc: 'te-form (iku)' },
  { suffix: 'きて', replacement: 'くる', desc: 'te-form (kuru)' },
  { suffix: 'て', replacement: 'る', desc: 'te-form (ichidan)' },

  // Negative: ない
  { suffix: 'かない', replacement: 'く', desc: 'negative (godan k)' },
  { suffix: 'がない', replacement: 'ぐ', desc: 'negative (godan g)' },
  { suffix: 'さない', replacement: 'す', desc: 'negative (godan s)' },
  { suffix: 'たない', replacement: 'つ', desc: 'negative (godan t)' },
  { suffix: 'なない', replacement: 'ぬ', desc: 'negative (godan n)' },
  { suffix: 'まない', replacement: 'む', desc: 'negative (godan m)' },
  { suffix: 'らない', replacement: 'る', desc: 'negative (godan r)' },
  { suffix: 'わない', replacement: 'う', desc: 'negative (godan u)' },
  { suffix: 'しない', replacement: 'する', desc: 'negative (suru)' },
  { suffix: 'こない', replacement: 'くる', desc: 'negative (kuru)' },
  { suffix: 'ない', replacement: 'る', desc: 'negative (ichidan)' },

  // Negative past: なかった
  { suffix: 'かなかった', replacement: 'く', desc: 'negative past (godan k)' },
  { suffix: 'がなかった', replacement: 'ぐ', desc: 'negative past (godan g)' },
  { suffix: 'さなかった', replacement: 'す', desc: 'negative past (godan s)' },
  { suffix: 'たなかった', replacement: 'つ', desc: 'negative past (godan t)' },
  { suffix: 'まなかった', replacement: 'む', desc: 'negative past (godan m)' },
  { suffix: 'らなかった', replacement: 'る', desc: 'negative past (godan r)' },
  { suffix: 'わなかった', replacement: 'う', desc: 'negative past (godan u)' },
  { suffix: 'しなかった', replacement: 'する', desc: 'negative past (suru)' },
  { suffix: 'こなかった', replacement: 'くる', desc: 'negative past (kuru)' },
  { suffix: 'なかった', replacement: 'る', desc: 'negative past (ichidan)' },

  // Potential / Passive:
  { suffix: 'られる', replacement: 'る', desc: 'passive/potential (ichidan)' },
  { suffix: 'れる', replacement: 'る', desc: 'potential (ichidan)' },
  { suffix: 'える', replacement: 'う', desc: 'potential (godan u)' },
  { suffix: 'ける', replacement: 'く', desc: 'potential (godan k)' },
  { suffix: 'げる', replacement: 'ぐ', desc: 'potential (godan g)' },
  { suffix: 'せる', replacement: 'す', desc: 'potential (godan s)' },
  { suffix: 'てる', replacement: 'つ', desc: 'potential (godan t)' },
  { suffix: 'ねる', replacement: 'ぬ', desc: 'potential (godan n)' },
  { suffix: 'める', replacement: 'む', desc: 'potential (godan m)' },
  { suffix: 'れる', replacement: 'る', desc: 'potential (godan r)' },

  // Causative: せる / させる
  { suffix: 'させる', replacement: 'る', desc: 'causative (ichidan)' },
  { suffix: 'かせる', replacement: 'く', desc: 'causative (godan k)' },
  { suffix: 'がせる', replacement: 'ぐ', desc: 'causative (godan g)' },
  { suffix: 'たせる', replacement: 'つ', desc: 'causative (godan t)' },
  { suffix: 'ませる', replacement: 'む', desc: 'causative (godan m)' },
  { suffix: 'らせる', replacement: 'る', desc: 'causative (godan r)' },
  { suffix: 'わせる', replacement: 'う', desc: 'causative (godan u)' },

  // Volitional: よう / おう
  { suffix: 'よう', replacement: 'る', desc: 'volitional (ichidan)' },
  { suffix: 'こう', replacement: 'く', desc: 'volitional (godan k)' },
  { suffix: 'ごう', replacement: 'ぐ', desc: 'volitional (godan g)' },
  { suffix: 'そう', replacement: 'す', desc: 'volitional (godan s)' },
  { suffix: 'とう', replacement: 'つ', desc: 'volitional (godan t)' },
  { suffix: 'のう', replacement: 'ぬ', desc: 'volitional (godan n)' },
  { suffix: 'もう', replacement: 'む', desc: 'volitional (godan m)' },
  { suffix: 'ろう', replacement: 'る', desc: 'volitional (godan r)' },
  { suffix: 'おう', replacement: 'う', desc: 'volitional (godan u)' },

  // Conditional: ば / たら
  { suffix: 'れば', replacement: 'る', desc: 'conditional ba (ichidan)' },
  { suffix: 'えば', replacement: 'う', desc: 'conditional ba (godan u)' },
  { suffix: 'けば', replacement: 'く', desc: 'conditional ba (godan k)' },
  { suffix: 'げば', replacement: 'ぐ', desc: 'conditional ba (godan g)' },
  { suffix: 'せば', replacement: 'す', desc: 'conditional ba (godan s)' },
  { suffix: 'てば', replacement: 'つ', desc: 'conditional ba (godan t)' },
  { suffix: 'ねば', replacement: 'ぬ', desc: 'conditional ba (godan n)' },
  { suffix: 'めば', replacement: 'む', desc: 'conditional ba (godan m)' },
  { suffix: 'たら', replacement: 'る', desc: 'conditional tara (ichidan)' },

  // I-Adjectives:
  { suffix: 'かった', replacement: 'い', desc: 'adj-i past' },
  { suffix: 'くない', replacement: 'い', desc: 'adj-i negative' },
  { suffix: 'くなかった', replacement: 'い', desc: 'adj-i negative past' },
  { suffix: 'くて', replacement: 'い', desc: 'adj-i te-form' },
  { suffix: 'ければ', replacement: 'い', desc: 'adj-i conditional' }
];

export class Deinflector {
  /**
   * Given an inflected word (e.g. 食べた, 飲みます, 美しかった),
   * return a list of potential dictionary base forms.
   * Always includes the original word as the first candidate.
   */
  static deinflect(word) {
    if (!word || typeof word !== 'string') return [];

    const candidates = new Set();
    candidates.add(word); // Original word first

    for (const rule of DEINFLECTION_RULES) {
      if (word.endsWith(rule.suffix) && word.length >= rule.suffix.length) {
        const base = word.slice(0, word.length - rule.suffix.length) + rule.replacement;
        if (base.length > 0) {
          candidates.add(base);
        }
      }
    }

    return Array.from(candidates);
  }
}
