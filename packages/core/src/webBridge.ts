import { AsturError } from './errors.js';

/**
 * A web (DOM) context inside a native WebView, driven purely through a single
 * `evaluate(jsExpression) -> JSON` transport. All querying, locator generation
 * and interaction happen *inside the page* via the embedded bridge below, so the
 * behaviour is identical regardless of engine (Chromium WebView on Android,
 * WKWebView on iOS) or host framework (Flutter, React Native) — the native side
 * never touches engine-specific element handles.
 */

/** Minimal transport: ship a JS expression to the page, get its JSON value back. */
export interface WebEvaluator {
  evaluate(expression: string): Promise<unknown>;
  dispose(): Promise<void>;
}

export type WebLocatorStrategy = 'testid' | 'id' | 'role' | 'text' | 'css';

export interface WebLocatorDescriptor {
  strategy: WebLocatorStrategy;
  value: string;
  /** Accessible name, only for the `role` strategy. */
  name?: string;
}

export interface WebElementSnapshot {
  tag: string;
  id?: string;
  testId?: string;
  role?: string;
  name?: string;
  value?: string;
  /** CSS pixels relative to the WebView viewport. */
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  enabled: boolean;
  /** The best (most stable) locator Astur would generate for this element. */
  locator: WebLocatorDescriptor;
  children: WebElementSnapshot[];
}

export interface WebTreeSnapshot {
  /** window.devicePixelRatio — maps CSS px (bounds) to device px for overlays. */
  devicePixelRatio: number;
  /** Visual viewport size in CSS px. */
  viewport: { width: number; height: number };
  url: string;
  title: string;
  root: WebElementSnapshot;
}

interface BridgeResult {
  ok: boolean;
  error?: string;
  value?: unknown;
}

// Stateless in-page bridge. Each call constructs it fresh — no install step to go
// stale across navigations. Pure DOM; runs in any browser engine.
const WEB_BRIDGE_SRC = `function(){
  function vis(el){
    if(!el||el.nodeType!==1) return false;
    var s=window.getComputedStyle(el);
    if(s.display==='none'||s.visibility==='hidden'||parseFloat(s.opacity||'1')===0) return false;
    var r=el.getBoundingClientRect();
    return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<(window.innerHeight||0)+1&&r.left<(window.innerWidth||0)+1;
  }
  function rect(el){var r=el.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)};}
  function txt(el){return ((el.textContent||'').trim()).replace(/\\s+/g,' ');}
  function role(el){
    var ex=el.getAttribute&&el.getAttribute('role'); if(ex) return ex;
    var t=el.tagName.toLowerCase();
    if(t==='a'&&el.hasAttribute('href')) return 'link';
    if(t==='button') return 'button';
    if(t==='input'){var ty=(el.getAttribute('type')||'text').toLowerCase();
      if(ty==='button'||ty==='submit'||ty==='reset'||ty==='image') return 'button';
      if(ty==='checkbox') return 'checkbox'; if(ty==='radio') return 'radio';
      if(ty==='range') return 'slider'; return 'textbox';}
    if(t==='select') return 'combobox'; if(t==='textarea') return 'textbox';
    if(t==='img') return 'img'; if(/^h[1-6]$/.test(t)) return 'heading';
    return '';
  }
  function name(el){
    var al=el.getAttribute&&el.getAttribute('aria-label'); if(al) return al.trim();
    var lb=el.getAttribute&&el.getAttribute('aria-labelledby');
    if(lb){var n=document.getElementById(lb); if(n) return txt(n);}
    if(el.id){var lab=document.querySelector('label[for="'+(window.CSS&&CSS.escape?CSS.escape(el.id):el.id)+'"]'); if(lab) return txt(lab);}
    var tag=el.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'){if(el.getAttribute('placeholder')) return el.getAttribute('placeholder'); if(el.value) return String(el.value);}
    return txt(el).slice(0,120);
  }
  function testId(el){return (el.getAttribute&&(el.getAttribute('data-testid')||el.getAttribute('data-test-id')||el.getAttribute('data-test')))||'';}
  function selfCss(el){
    if(el.id) return '#'+(window.CSS&&CSS.escape?CSS.escape(el.id):el.id);
    var t=el.tagName.toLowerCase(); var p=el.parentElement; if(!p) return t;
    var sibs=Array.prototype.filter.call(p.children,function(c){return c.tagName===el.tagName;});
    if(sibs.length<2) return t;
    return t+':nth-of-type('+(Array.prototype.indexOf.call(sibs,el)+1)+')';
  }
  function cssPath(el){
    if(el.id) return '#'+(window.CSS&&CSS.escape?CSS.escape(el.id):el.id);
    var parts=[]; var cur=el;
    while(cur&&cur.nodeType===1&&parts.length<6){parts.unshift(selfCss(cur)); if(cur.id) break; cur=cur.parentElement;}
    return parts.join(' > ');
  }
  function best(el){
    var tid=testId(el); if(tid) return {strategy:'testid',value:tid};
    if(el.id) return {strategy:'id',value:el.id};
    var r=role(el), nm=name(el);
    if(r&&nm&&nm.length<=80) return {strategy:'role',value:r,name:nm};
    if(nm&&nm.length<=80&&el.children.length===0) return {strategy:'text',value:nm};
    return {strategy:'css',value:cssPath(el)};
  }
  function interesting(el){return !!(testId(el)||el.id||(role(el))||(el.children.length===0&&txt(el)));}
  function node(el,depth){
    var children=[];
    if(depth<30){for(var i=0;i<el.children.length;i++){var c=node(el.children[i],depth+1); if(c) children.push(c);}}
    if(!interesting(el)&&children.length===0) return null;
    var r=role(el);
    return {tag:el.tagName.toLowerCase(),id:el.id||undefined,testId:testId(el)||undefined,
      role:r||undefined,name:name(el)||undefined,
      value:(el.value!=null&&el.value!=='')?String(el.value):undefined,
      bounds:rect(el),visible:vis(el),enabled:!el.disabled,locator:best(el),children:children};
  }
  function all(){return Array.prototype.slice.call(document.querySelectorAll('*'));}
  function resolve(loc){
    if(!loc) return null;
    if(loc.strategy==='css'){try{return document.querySelector(loc.value);}catch(e){return null;}}
    if(loc.strategy==='id'){return document.getElementById(loc.value);}
    var els=all();
    for(var i=0;i<els.length;i++){var el=els[i];
      if(loc.strategy==='testid'){if(testId(el)===loc.value) return el;}
      else if(loc.strategy==='role'){if(role(el)===loc.value&&(!loc.name||name(el)===loc.name)) return el;}
      else if(loc.strategy==='text'){if(txt(el)===loc.value&&el.children.length===0) return el;}
    }
    if(loc.strategy==='text'){for(var j=0;j<els.length;j++){if(txt(els[j]).indexOf(loc.value)>=0&&els[j].children.length===0) return els[j];}}
    return null;
  }
  function fire(el,type){el.dispatchEvent(new Event(type,{bubbles:true}));}
  function setValue(el,v){
    var proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement:(el.tagName==='SELECT'?window.HTMLSelectElement:window.HTMLInputElement);
    var d=Object.getOwnPropertyDescriptor(proto.prototype,'value');
    if(d&&d.set){d.set.call(el,v);}else{el.value=v;}
    fire(el,'input'); fire(el,'change');
  }
  return {
    snapshot:function(){
      return {ok:true,value:{devicePixelRatio:window.devicePixelRatio||1,
        viewport:{width:Math.round((window.visualViewport&&window.visualViewport.width)||window.innerWidth||0),height:Math.round((window.visualViewport&&window.visualViewport.height)||window.innerHeight||0)},
        url:location.href,title:document.title,root:node(document.body||document.documentElement,0)}};
    },
    act:function(loc,action,arg){
      var el=resolve(loc);
      if(!el) return {ok:false,error:'No web element matched '+JSON.stringify(loc)};
      try{el.scrollIntoView({block:'center',inline:'center'});}catch(e){}
      if(action==='snapshot') return {ok:true,value:node(el,0)};
      if(action==='text') return {ok:true,value:txt(el)};
      if(action==='value') return {ok:true,value:el.value!=null?String(el.value):txt(el)};
      if(action==='tap'||action==='click'){if(typeof el.focus==='function'){try{el.focus();}catch(e){}} el.click(); return {ok:true};}
      if(action==='fill'){if(el.isContentEditable){el.textContent=arg==null?'':String(arg); fire(el,'input');}else{try{el.focus();}catch(e){} setValue(el,arg==null?'':String(arg));} return {ok:true};}
      if(action==='clear'){if(el.isContentEditable){el.textContent=''; fire(el,'input');}else{setValue(el,'');} return {ok:true};}
      if(action==='select'){setValue(el,arg==null?'':String(arg)); return {ok:true};}
      return {ok:false,error:'Unknown web action '+action};
    },
    hitTest:function(x,y){
      var el=document.elementFromPoint(x,y);
      if(!el) return {ok:false,error:'No web element at point'};
      return {ok:true,value:{snapshot:node(el,0),locator:best(el)}};
    }
  };
}`;

function callExpr(method: string, ...args: unknown[]): string {
  const serialized = args.map((arg) => JSON.stringify(arg ?? null)).join(',');
  return `(${WEB_BRIDGE_SRC})().${method}(${serialized})`;
}

function unwrap(raw: unknown): unknown {
  const result = raw as BridgeResult | undefined;
  if (!result || typeof result !== 'object') {
    throw new AsturError('WEB_BRIDGE_EVAL_FAILED', 'Web bridge returned no result.');
  }
  if (!result.ok) {
    throw new AsturError('WEB_ELEMENT_NOT_FOUND', result.error ?? 'Web bridge action failed.');
  }
  return result.value;
}

/** A located DOM element inside a WebView; actions run as injected JS. */
export class WebLocator {
  constructor(
    private readonly evaluator: WebEvaluator,
    readonly descriptor: WebLocatorDescriptor
  ) {}

  /** Playwright-style string form, e.g. getByTestId('astur-submit'). */
  toString(): string {
    const d = this.descriptor;
    switch (d.strategy) {
      case 'testid': return `getByTestId(${JSON.stringify(d.value)})`;
      case 'id': return `getById(${JSON.stringify(d.value)})`;
      case 'role': return `getByRole(${JSON.stringify(d.value)}${d.name ? `, { name: ${JSON.stringify(d.name)} }` : ''})`;
      case 'text': return `getByText(${JSON.stringify(d.value)})`;
      default: return `locator(${JSON.stringify(d.value)})`;
    }
  }

  async fill(value: string): Promise<void> {
    unwrap(await this.evaluator.evaluate(callExpr('act', this.descriptor, 'fill', value)));
  }

  async clear(): Promise<void> {
    unwrap(await this.evaluator.evaluate(callExpr('act', this.descriptor, 'clear')));
  }

  async tap(): Promise<void> {
    unwrap(await this.evaluator.evaluate(callExpr('act', this.descriptor, 'tap')));
  }

  async selectOption(value: string): Promise<void> {
    unwrap(await this.evaluator.evaluate(callExpr('act', this.descriptor, 'select', value)));
  }

  async textContent(): Promise<string> {
    return String(unwrap(await this.evaluator.evaluate(callExpr('act', this.descriptor, 'text'))) ?? '');
  }

  async inputValue(): Promise<string> {
    return String(unwrap(await this.evaluator.evaluate(callExpr('act', this.descriptor, 'value'))) ?? '');
  }

  async snapshot(): Promise<WebElementSnapshot> {
    return unwrap(await this.evaluator.evaluate(callExpr('act', this.descriptor, 'snapshot'))) as WebElementSnapshot;
  }
}

/** A DOM context inside a native WebView. */
export class WebContext {
  constructor(private readonly evaluator: WebEvaluator) {}

  /** Full DOM tree (Astur element shape) plus viewport/DPR for overlay mapping. */
  async snapshot(): Promise<WebTreeSnapshot> {
    return unwrap(await this.evaluator.evaluate(callExpr('snapshot'))) as WebTreeSnapshot;
  }

  /** Element at a CSS-pixel point, with the best locator Astur would generate. */
  async elementAt(x: number, y: number): Promise<{ snapshot: WebElementSnapshot; locator: WebLocatorDescriptor }> {
    return unwrap(await this.evaluator.evaluate(callExpr('hitTest', x, y))) as {
      snapshot: WebElementSnapshot;
      locator: WebLocatorDescriptor;
    };
  }

  locatorFor(descriptor: WebLocatorDescriptor): WebLocator {
    return new WebLocator(this.evaluator, descriptor);
  }

  getByTestId(value: string): WebLocator {
    return new WebLocator(this.evaluator, { strategy: 'testid', value });
  }

  getById(value: string): WebLocator {
    return new WebLocator(this.evaluator, { strategy: 'id', value });
  }

  getByRole(role: string, options?: { name?: string }): WebLocator {
    return new WebLocator(this.evaluator, { strategy: 'role', value: role, name: options?.name });
  }

  getByText(value: string): WebLocator {
    return new WebLocator(this.evaluator, { strategy: 'text', value });
  }

  locator(css: string): WebLocator {
    return new WebLocator(this.evaluator, { strategy: 'css', value: css });
  }

  /** Evaluate a raw JS expression in the page (advanced/escape hatch). */
  async evaluate(expression: string): Promise<unknown> {
    return this.evaluator.evaluate(expression);
  }

  async close(): Promise<void> {
    await this.evaluator.dispose();
  }
}
