import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectScript, guessLatinLang, isNonLatinLang, langFor, localCheck, safeLangTag, splitSentences } from './script.ts';

test('detectScript covers Devanagari, Bengali, Tamil, Telugu, Kannada, Arabic and CJK', () => {
  assert.equal(detectScript('UrbanCare AI में उन्होंने क्या बनाया?'), 'devanagari');
  assert.equal(detectScript('তিনি কোন প্রকল্পে কাজ করেছেন?'), 'bengali');
  assert.equal(detectScript('அவர் என்ன திட்டங்கள் செய்தார்?'), 'tamil');
  assert.equal(detectScript('అతను ఏ ప్రాజెక్టులు చేశాడు?'), 'telugu');
  assert.equal(detectScript('ಅವರು ಯಾವ ಯೋಜನೆಗಳನ್ನು ಮಾಡಿದರು?'), 'kannada');
  assert.equal(detectScript('ما هي مشاريعه؟'), 'arabic');
  assert.equal(detectScript('他做过哪些项目？'), 'cjk');
  assert.equal(detectScript('彼はどんなプロジェクトを作りましたか？'), 'cjk');
  assert.equal(detectScript('그는 어떤 프로젝트를 했나요?'), 'cjk');
  assert.equal(detectScript('What did he build?'), 'latin');
  assert.equal(detectScript('¿Qué proyectos hizo?'), 'latin');
  assert.equal(detectScript('12345 ?!'), 'other');
});

test('a few non-Latin letters inside an English question keep it Latin', () => {
  assert.equal(detectScript('What does the word नमस्ते mean in his Vyapar-Gyan project and its Hindi support for shops?'), 'latin');
});

test('langFor picks the tag from the script, refined by browser languages', () => {
  assert.equal(langFor('UrbanCare AI में उन्होंने क्या बनाया?'), 'hi');
  assert.equal(langFor('त्यांनी कोणते प्रकल्प केले?', ['mr-IN', 'en']), 'mr');
  assert.equal(langFor('তিনি কোন প্রকল্পে কাজ করেছেন?'), 'bn');
  assert.equal(langFor('ما هي مشاريعه؟'), 'ar');
  assert.equal(langFor('ان کے پراجیکٹس کیا ہیں؟ کیا انہوں نے ٹیم کے ساتھ کام کیا؟'), 'ur');
  assert.equal(langFor('他做过哪些项目？'), 'zh');
  assert.equal(langFor('彼はどんなプロジェクトを作りましたか？'), 'ja');
  assert.equal(langFor('그는 어떤 프로젝트를 했나요?'), 'ko');
  assert.equal(langFor('What did he build?'), null);
  assert.ok(isNonLatinLang(langFor('அவர் என்ன திட்டங்கள் செய்தார்?')));
  assert.equal(isNonLatinLang('es'), false);
});

test('guessLatinLang recognises Spanish, French, German, Portuguese and Italian, and leaves English alone', () => {
  assert.equal(guessLatinLang('¿Qué proyectos hizo con Gemini?'), 'es');
  assert.equal(guessLatinLang('Quels sont ses projets avec LangGraph ?'), 'fr');
  assert.equal(guessLatinLang('Welche Projekte hat er mit Python gemacht?'), 'de');
  assert.equal(guessLatinLang('Quais projetos ele fez com Python?'), 'pt');
  assert.equal(guessLatinLang('Quali progetti ha fatto con Python?'), 'it');
  assert.equal(guessLatinLang('What projects did he build with Python?'), null);
  assert.equal(guessLatinLang('UrbanCare'), null);
});

test('an unknown lang tag is ignored', () => {
  assert.equal(safeLangTag('hi'), 'hi');
  assert.equal(safeLangTag('hi-IN'), 'hi');
  assert.equal(safeLangTag('xx'), null);
  assert.equal(safeLangTag('en"><script>'), null);
  assert.equal(safeLangTag(42), null);
});

const entities = {
  companies: ['Mindrift', 'iHUB DivyaSampark @ IIT Roorkee'],
  institutions: ['University of Pittsburgh (Coursera)'],
  projectNames: ['UrbanCare AI', 'Vyapar-Gyan'],
  skills: ['Statistics', 'LangGraph'],
  tech: ['Python', 'MedGemma', 'Gemini'],
};
const EN = 'UrbanCare AI reached 86% accuracy with MedGemma [c:project:urbancare-ai#solution].';

test('a local text missing "86" falls back to English', () => {
  assert.deepEqual(localCheck(EN, 'UrbanCare AI ने MedGemma के साथ उच्च सटीकता हासिल की [c:project:urbancare-ai#solution]।', entities), {
    ok: false,
    reason: 'number:86',
  });
});

test('digits in another script count, names must stay in Latin script, nothing may be added', () => {
  assert.deepEqual(localCheck(EN, 'UrbanCare AI ने MedGemma के साथ ८६% सटीकता हासिल की।', entities), { ok: true });
  assert.deepEqual(localCheck(EN, 'UrbanCare AI ने MedGemma के साथ 86% सटीकता हासिल की।', entities), { ok: true });
  assert.deepEqual(localCheck(EN, 'अर्बनकेयर एआई ने MedGemma के साथ 86% सटीकता हासिल की।', entities), {
    ok: false,
    reason: 'name:UrbanCare AI',
  });
  assert.equal(localCheck(EN, 'UrbanCare AI ने MedGemma के साथ 86% सटीकता 2024 में हासिल की।', entities).ok, false);
  assert.equal(localCheck(EN, 'UrbanCare AI ने Google DeepMind में MedGemma के साथ 86% सटीकता हासिल की।', entities).ok, false);
  assert.equal(localCheck(EN, '', entities).ok, false);
  // A generic skill word may be translated.
  assert.equal(localCheck('He lists Statistics [c:skills:data-science-ml].', 'वे सांख्यिकी को सूचीबद्ध करते हैं।', entities).ok, true);
});

test('splitSentences keeps markers with their sentence, in any script', () => {
  assert.deepEqual(splitSentences('पहला वाक्य [c:exp:0]। दूसरा वाक्य।'), ['पहला वाक्य [c:exp:0]। ', 'दूसरा वाक्य।']);
  assert.deepEqual(splitSentences('One. Two?'), ['One. ', 'Two?']);
});
