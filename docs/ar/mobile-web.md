# الويب على الجوال (Mobile Web)

تتيح لك `device.browser` تشغيل **صفحة ويب داخل متصفح الجهاز نفسه** — Chrome على Android و Safari على iOS — وعلى المحاكي أو الجهاز الحقيقي ذاته الذي تعمل عليه اختباراتك الأصلية.

```ts
const page = await device.browser.open('https://example.com/pricing');

await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
await page.getByTestId('plan-pro').tap();
```

## متى تكون هذه هي الأداة المناسبة

يقدّم Astur واجهتين للويب، وكل منهما تجيب عن سؤال مختلف:

| ما الذي تختبره | استخدم |
| --- | --- |
| شاشة WebView **داخل** تطبيقك | [`device.webContext()`](../frameworks/#webviews-dom) |
| **موقع ويب** داخل متصفح الجهاز | `device.browser` |

وما دون مستوى الصفحة فالآلية واحدة: فبمجرد أن يصبح التبويب (Tab) قابلاً للفحص، يقوده جسر الـ JS المحقون نفسه. وما يضيفه المتصفح هو الهدف (Target) والتنقل بين الصفحات.

**يختبر Playwright الويب على الجوال باقتدار** عبر محاكاة الأجهزة (Device Emulation)، وهو أسرع وأسهل في بيئات التكامل المستمر (CI). فاختر `device.browser` حين لا تكون المحاكاة كافية لغرضك: متصفح Android أو iOS حقيقي، على مجموعة الأجهزة ذاتها، وضمن التشغيل والتقرير نفسه الذي تصدره اختباراتك الأصلية.

## الإعداد

اضبط `browser` بدلاً من `app`:

```ts
export default defineConfig({
  use: {
    astur: {
      platform: 'android',
      device: { kind: 'emulator', avd: 'Pixel_9_API_35' },
      browser: { engine: 'chrome' }   // 'safari' على iOS
    }
  }
});
```

الإعداد الذي يحتوي `browser` دون `app` يُنشئ **جلسة متصفح خالصة (Browser-only Session)**: فيتخطى Astur تثبيت التطبيق، ويتعامل مع الوكيل الأصلي (Native Agent) كخيار لا كشرط. وعلى iOS تحديداً، هذا هو الفارق بين أن تفتح صفحة ويب مباشرةً وبين أن تحتاج أولاً إلى هوية توقيع (Signing Identity) من Xcode.

واضبط `app` و `browser` معاً حين تؤدي مجموعة اختبارات واحدة المهمتين بالتناوب؛ عندها يبقى الإعداد الأصلي كما هو تماماً.

كل من `engine` و `id` اختياري — إذ يأخذ `engine` القيمة الافتراضية لمتصفح المنصة، بينما يتيح `id` تجاوز اسم الحزمة أو معرّفها لقناة أخرى من Chrome مثل `com.chrome.beta`.

## الواجهة البرمجية

```ts
// ما الذي تستطيع هذه الجلسة فعله بالمتصفح؟
const capabilities = await device.browser.capabilities();
// { supported, engine, identifier, coverage }

const page = await device.browser.open('https://example.com');   // WebContext
const next = await device.browser.navigate('https://example.com/pricing');
const again = await device.browser.reload();
const back = await device.browser.back();
await device.browser.forward();

await device.browser.url();     // الرابط الحالي
await device.browser.close();   // يغلق التبويب ويترك المتصفح يعمل
```

تُعيد كل عملية تنقل الصفحة الحيّة — فاستخدم المُعرِّف (Handle) الذي حصلت عليه منها من تلك النقطة فصاعداً.

## دورة حياة التبويب

قريبة من سلوك Playwright، ضمن ما تسمح به كل منصة:

- **تمنح `open()` كل اختبار تبويباً جديداً.** فعلى Android يُنشئ Astur تبويباً عبر مقبس التنقيح (Debugging Socket)، تماماً كما يفتح Playwright صفحة جديدة.
- **يُغلق التبويب عند انتهاء الاختبار.** تتولى تجهيزة (Fixture) Astur ذلك نيابةً عنك، فلا تتراكم التبويبات، ولا يرث اختبارٌ ما تركه سابقه من محتوى الصفحة (DOM) أو سجل التنقل أو موضع التمرير.
- **تُحمّل `open()` الصفحة دائماً**، حتى لو كان التبويب يعرض الرابط ذاته، حتى لا يسلّم تبويبٌ مُعاد استخدامه نموذجاً معبّأً من اختبار إلى الذي يليه.

أما بيانات التخزين فمسألة منفصلة، وهي **غير معزولة** — راجع [القيود](#القيود).

وكل ما تعيده الصفحة هو كائن `WebContext`، وهو نفسه الذي تمنحك إياه `device.webContext()` — بدواله `getByTestId` و `getById` و `getByRole` و `getByText` و `locator(css)` و `fill` و `tap` و `textContent` و `evaluate`.

## اسأل قبل أن تؤكّد

تجيب `capabilities()` على كل منصة، وهو ما يُبقي ملف الاختبار قابلاً للنقل بينها:

```ts
const capabilities = await device.browser.capabilities();
test.skip(!capabilities.supported, capabilities.coverage);
```

## القيود

يستحق هذا القسم قراءة متأنية قبل بناء مجموعة اختبارات فوق هذه الميزة. وليست هذه القيود أخطاءً برمجية، بل هي حدود ما تتيحه المنصات نفسها.

| القيد | السبب | يشمل |
| --- | --- | --- |
| **لا عزل لبيانات التخزين** | التبويب ليس سياق متصفح (Browser Context) بمفهوم Playwright. فملفات الارتباط (Cookies) و `localStorage` والأذونات تعود إلى ملف تعريف المتصفح، وتتشاركها التبويبات جميعاً. | المنصتان |
| **لا عزل للتبويبات على iOS** | لا يكشف مفتّش WebKit عن أي واجهة لإنشاء تبويب في Safari أو إغلاقه، فتُعيد الجلسة استخدام تبويب واحد وتحدّثه. | iOS |
| **واجهة المتصفح ليست جزءاً من الصفحة** | شريط العنوان ومبدّل التبويبات ونوافذ الأذونات عناصر أصلية (Native)؛ تحتاج محدّدات أصلية ووكيلاً، ولا تتوفر لها كائنات صفحات (Page Objects) بعد. | المنصتان |
| **لا تبديل بين التبويبات ولا نوافذ متعددة** | لا يُخاطَب سوى التبويب قيد الاختبار. | المنصتان |
| **يجب تجاوز شاشة التشغيل الأول في Chrome** | فقبل إتمام شاشة الترحيب لا يفتح Chrome أي تبويب ولا ينشر مقبس التنقيح. ويُبلَّغ عن ذلك بالخطأ `BROWSER_FIRST_RUN_PENDING` بدلاً من انتظار مهلة تنتهي دون طائل. | Android |
| **أجهزة iOS الحقيقية لم يجرِ التحقق منها** | مسار الكود موجود (`devicectl` ثم Safari) لكنه لم يُشغَّل على جهاز فعلي. | جهاز iOS حقيقي |

وإذا اعتمد اختبارك على أن يبدأ من حالة «غير مسجّل الدخول»، فامسح تلك البيانات صراحةً بدل افتراض أن التبويب الجديد قد فعل ذلك:

```ts
await page.evaluate('localStorage.clear(); sessionStorage.clear()');
```

## المتطلبات المسبقة

يحتاج **Android** إلى وجود Chrome مثبّتاً، وإلى تفعيل تنقيح USB (وهو ما يجعل `chrome_devtools_remote` قابلاً للوصول)، وإلى تجاوز **شاشة التشغيل الأول (First Run)**. فحتى تكتمل شاشة الترحيب تلك، لا يفتح Chrome أي تبويب ولا ينشر مقبس تنقيح — ويرصد Astur ذلك ويفشل بالخطأ `BROWSER_FIRST_RUN_PENDING` بدل انتظار صفحة لن تظهر أبداً. ويكفي إتمامها مرة واحدة لكل نسخة محاكي.

ويحتاج **iOS** إلى أداة `ios-webkit-debug-proxy` (الإصدار 1.9 فأعلى):

```bash
brew install ios-webkit-debug-proxy
```

وعلى **الجهاز الحقيقي**، فعّل أيضاً: الإعدادات ▸ Safari ▸ متقدم ▸ Web Inspector. أما المحاكي فلا يحتاج شيئاً إضافياً — إذ يجسر Astur مقبس المفتّش الخاص به تلقائياً.

ويُبلغ الأمر `npx astur-mobile doctor` عن جاهزية المنصتين معاً.

## جرّبها بنفسك

تقدّم مجموعة الأمثلة صفحتها الخاصة من داخل المستودع، فتعمل دون اتصال بالإنترنت وبنتائج ثابتة:

```bash
cd examples
npm run test:android:browser
npm run test:ios:browser
```

راجع [Flutter و React Native](../frameworks/) لواجهات WebView داخل التطبيقات، و[حدود المنصات](../platform-limits/) للمرجع الكامل للحدود.
