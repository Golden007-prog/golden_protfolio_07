declare global {
  interface Window {
    /** Date.now() when the head bootstrap ran; the intro curtain caps its wall-clock time from here. */
    __navStart?: number;
  }
}

/*
 * Inlined in <head> and run before first paint, so theme, motion, lite and intro
 * state are on <html> before any CSS or hydration looks at them. Plain ES5 in a
 * string: it must not depend on bundler output, and every storage or matchMedia
 * access is guarded because either can throw when site data is blocked.
 *
 * Keys: localStorage 'theme' (light|dark|system, default dark), localStorage
 * 'ob-motion' (reduced|full), sessionStorage 'ob-paused' and 'ob-seen-loader-v2'.
 * Keep in step with useMotionPrefs, ThemeContext and IntroContext.
 */
export const BOOTSTRAP_SCRIPT = `(function(){
var d=document.documentElement,w=window,n=navigator,l=location;
function ls(k){try{return w.localStorage.getItem(k)}catch(e){return null}}
function ss(k){try{return w.sessionStorage.getItem(k)}catch(e){return null}}
function mq(q){try{return w.matchMedia(q).matches}catch(e){return false}}
w.__navStart=Date.now();
d.classList.add('js');
var t=ls('theme');
var theme=t==='light'?'light':t==='system'?(mq('(prefers-color-scheme: light)')?'light':'dark'):'dark';
d.setAttribute('data-theme',theme);
var o=ls('ob-motion');
var reduce=o==='reduced'||(o!=='full'&&mq('(prefers-reduced-motion: reduce)'));
d.setAttribute('data-motion',reduce?'reduced':'full');
if(reduce||ss('ob-paused')==='1')d.setAttribute('data-motion-paused','');
var c=n.connection||{};
var lite=mq('(pointer: coarse)')||(n.hardwareConcurrency||8)<=4||(n.deviceMemory||8)<=4||c.saveData===true;
if(lite)d.setAttribute('data-lite','');
var deep=/[?&](project|skill)=/.test(l.search)||l.hash.length>1;
var home=l.pathname==='/';
var intro=home&&!deep&&!reduce&&!ss('ob-seen-loader-v2');
d.setAttribute('data-intro',intro?'pending':'seen');
if(!home||deep){try{w.sessionStorage.setItem('ob-seen-loader-v2','1')}catch(e){}}
var color=theme==='light'?'#F7F5F0':'#060609';
function paint(){var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute('content',color)}
paint();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paint);
})();`;
