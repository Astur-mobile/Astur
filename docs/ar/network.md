# مراقبة الشبكة

راقب طلبات HTTP التي يرسلها تطبيقك أثناء قيادة الاختبار له — ما الذي طلبه، وما الذي عاد، وكم استغرق.

## لماذا تحتاجها

حين تسيء شاشةٌ التصرّف، يكون السؤال المهم عادةً: *«ما الذي طلبه التطبيق من الخادم فعلًا؟»* وبدون إجابة تعود إلى قراءة سجلات التطبيق جنبًا إلى جنب مع تشغيل الاختبار، وتخمين العلاقة بينهما.

عمليًا، تتيح لك:

- **التأكيد على الطلب نفسه لا على البكسلات فقط.** فجملة «النقر على حفظ يرسل POST إلى ‎`/api/session`‎ ويعيد 201» أقوى بكثير من «ظهر إشعار نجاح».
- **التقاط الطلبات التي لم تتوقعها** — طلب مكرّر، أو عاصفة إعادة محاولة، أو نبضة تحليلات تنطلق مع كل ضغطة مفتاح.
- **تشخيص الفشل دون منقّح.** فالتشغيل الفاشل يخبرك أن الطلب أعاد 404، بدل أن يتركك تعيد إنتاج المشكلة يدويًا.
- **إبقاء الأسرار خارج تقاريرك.** إذ تُحجب ترويسات الاعتماد قبل أن يُعاد أي سجل إليك.

## ما تغطّيه وما لا تغطّيه

يبلّغ Astur عن **حركة التطبيق المُجهَّزة للرصد** — لا عن «كل حركة الجهاز» أبدًا. وهذا التمييز هو جوهر التصميم، ويستحق التصريح به: فطلبات WebView الخاصة، ونداءات حِزم SDK الأصلية، وحركة قنوات المنصة (platform channels) غير مرئية لهذه الطبقة، وستبقى كذلك.

| الهدف | الرصد | الاعتراض |
| --- | --- | --- |
| ‏Flutter على Android | **نعم** — مُحلّل HTTP في Dart VM | يحتاج المحوّل داخل التطبيق |
| ‏Flutter على iOS (محاكي) | **نعم** — مُحلّل HTTP في Dart VM | يحتاج المحوّل داخل التطبيق |
| ‏Flutter على iOS (جهاز حقيقي) | لا — خدمة VM غير قابلة للوصول من المضيف | يحتاج المحوّل داخل التطبيق |
| ‏React Native على Android | **نعم** — نطاق `Network` في CDP (بناء debug على Metro) | يحتاج المحوّل داخل التطبيق |
| ‏React Native على iOS | **نعم** — نطاق `Network` في CDP (بناء debug على Metro) | يحتاج المحوّل داخل التطبيق |
| التطبيقات الأصلية على Android / iOS | لا — لا يوجد خُطّاف مكافئ | يحتاج المحوّل داخل التطبيق |

في Flutter المصدر هو مُحلّل HTTP الخاص بـ `dart:io` في Dart VM — وهو المصدر نفسه الذي تقرأه شاشة Network في Flutter DevTools. ويغطي `HttpClient` من `dart:io`، وبالتالي `package:http` و Dio، لأن كليهما مبني عليه.

وفي React Native المصدر هو نطاق `Network` في CDP الذي تقرأه React Native DevTools. ولأن المُبلِّغ يقيم في `ReactCommon` — طبقة C++ المشتركة — فإن تطبيقًا واحدًا يغطي Android و iOS بالطريقة نفسها.

ويُكتشف الدعم **أثناء التشغيل**، بفحص الامتدادات المسجّلة في الـ isolate. ولا يُستنتج أبدًا من كون التطبيق «تطبيق Flutter» — وهذا مهم، لأن تطبيق Flutter نفسه قد يدعمه أو لا يدعمه حسب طريقة بنائه.

### ‏Flutter يحتاج بناء debug أو profile

تقرأ المراقبة خدمة Dart VM، و **بناء release (‏AOT) لا يملك واحدة** — فلا يوجد ما يُتصل به، على أيٍّ من المنصتين. أما بناءا debug و profile فينشران الخدمة. وهذا ليس قيدًا من Astur ولا يمكن الالتفاف عليه من الخارج:

- **‏Android** يُشغَّل عبر أداة Flutter، فيكون شرط debug جزءًا أصلًا من تشغيل المجموعة.
- **محاكي iOS** لا يحتاج شيئًا إضافيًا. فبناء `.app` من نوع debug يبدأ خدمة VM بنفسه ويسجّل رابطها، وعلى المحاكي يكون ذلك الرابط على loopback الخاص بالمضيف أصلًا — فيتصل به Astur دون تغيير طريقة تثبيت التطبيق أو تشغيله أو قيادته.
- **أجهزة iOS الحقيقية** تُبقي خدمة VM على الجهاز خلف نفق usbmuxd لا يفتحه Astur بعد. ويُبلَّغ عنها كغير مدعومة بدل محاولتها.

### ‏React Native يحتاج بناء debug متصلًا بـ Metro

يقع مُبلِّغ React Native خلف راية تُحدَّد وقت الترجمة اسمها `REACT_NATIVE_DEBUGGER_ENABLED`. وفي بناء release لا يكون الكود موجودًا أصلًا وتعيد `isDebuggingEnabled()` القيمة `false` — فتمامًا كما في بناء release/AOT في Flutter، لا يوجد ما يُتصل به ولا سبيل لتغيير ذلك من خارج التطبيق.

وما يعنيه ذلك عمليًا:

1. **شغّل بناء debug.** عبر `npx expo run:android` أو `npx react-native run-android` أو الأمر المكافئ على iOS.
2. **أبقِ Metro يعمل.** فالتطبيق هو من يتصل بخادم التطوير، ويتصل Astur بالخادم نفسه كعميل CDP عادي. وهو **لا** ينوب عن Metro، ولا يحتاج وسيطًا ولا شهادة ولا أي تغيير في طريقة تشغيل التطبيق أو قيادته.
3. **وجّه Astur إلى خادم التطوير** إن لم يكن على العنوان الافتراضي `http://127.0.0.1:8081` — عبر ضبط `ASTUR_RN_DEV_SERVER`.
4. **لا تدع التشغيل يعيد تثبيت بناء release** فوق بناء debug — فذلك يسحب هدف الـ inspector. وإعدادات بناء debug تمنح `app` قيمة `packageName`/`bundleId` دون `path`، كما تفعل `examples/config/{android,ios}/playwright.rn-debug.config.ts`.

على **iOS** لا يلزم شيء آخر: إذ يحمّل `AppDelegate` الافتراضي من Metro أصلًا تحت `#if DEBUG`. أما إعدادا Android أدناه فموجودان فقط لأن المشروع يستطيع تعطيلهما ليجعل بناء debug يعمل مستقلًا.

ويطابق Astur هدف الـ inspector بمعرّف التطبيق — اسم الحزمة على Android ومعرّف الحزمة على iOS — فلا يمكن أبدًا الخلط بين خادم تطوير تُرك يعمل لمشروع آخر والتطبيق قيد الاختبار.

وإذا كان تطبيق **Android** مضبوطًا ليعمل مستقلًا في وضع debug، فيجب إعادة إعدادين إلى قيمهما الافتراضية في React Native، و **كلاهما يخص debug فقط، فلا يتأثر بناء release ولو ببايت واحد**:

```kotlin
// android/app/src/main/java/…/MainApplication.kt
ExpoReactHostFactory.getDefaultReactHost(
  context = applicationContext,
  useDevSupport = BuildConfig.DEBUG,  // لا قيمة false مثبّتة
  …
)
```

```groovy
// android/app/build.gradle
react {
    debuggableVariants = ["debug"]   // لا []
}
```

#### ما الذي تغطّيه مراقبة React Native

كل ما يمرّ عبر **`XMLHttpRequest`** في React Native — أي الـ `fetch` المُطعَّم (polyfill) الخاص بـ RN، و `axios`، ومعظم مكتبات HTTP في المنظومة، لأنها جميعًا تنتهي إليه. وتصل الطلبات والاستجابات والحالات والتوقيتات والترويسات وأجسام الاستجابات كاملةً.

وهناك استثناء واحد يستحق التصريح به: **‏`fetch` الأصلي في Expo**. فمنذ الإصدار 52 تثبّت Expo تطبيقها الخاص لـ `fetch` كدالة عامة، مكتوبًا بكود أصلي، ولا يمرّ إطلاقًا عبر وحدة الشبكة في React Native — فلا يُصدر أي أحداث CDP. فإن كنت تستخدم Expo وأردت رصد نداء ما، فاستعمل `XMLHttpRequest` أو `axios` بدل `fetch` العام. وقد قيس هذا على بناء حيّ لا استُنتج: الطلب نفسه غير مرئي عبر `fetch` ومرصود بالكامل عبر `XMLHttpRequest`.

وكالعادة، تبقى طلبات WebView ونداءات حِزم SDK الأصلية وأي شيء يفتح مقابسه الخاصة غير مرئية.

### التطبيقات الأصلية

لا يكشف تطبيق Android أو iOS الأصلي أي خُطّاف مكافئ، فلا يوجد ما يُتصل به. وتحتاج هذه الحالة إلى المحوّل داخل التطبيق (أو وسيط MITM، وهو ما لا يشحنه Astur عن قصد — راجع [الاعتراض](#الاعتراض-غير-متاح-بعد)).

## كيف تستخدمها

اسأل دائمًا قبل أن تؤكّد. فـ `capabilities()` تجيب على كل منصة، ما يُبقي ملف الاختبار قابلًا للنقل:

```ts
import { expect, test } from './fixtures.js';

test('login posts credentials', async ({ app, device }) => {
  const capabilities = await device.network.capabilities();
  test.skip(!capabilities.observe, capabilities.coverage);

  await device.network.clear();
  await app.login.signIn('qa@astur.dev', 'Astur12345');

  const [request] = await device.network.requests({ url: '/api/session' });
  expect(request).toMatchObject({ method: 'POST', status: 201 });
  expect(request.durationMs).toBeLessThan(2_000);
});
```

استخدام `test.skip()` مع `capabilities.coverage` يعني أن المنصة غير المدعومة تُبلغ عن *سبب* التخطّي، بدل أن تمرّ بصمت.

### الواجهة البرمجية

```ts
// ما الذي تستطيع هذه الجلسة رؤيته فعلًا؟
const capabilities = await device.network.capabilities();
// { observe, intercept, transports, responseBodies, coverage, adapterRequired }

// كل ما التُقط حتى الآن، والأحدث في النهاية.
const all = await device.network.requests();

// تصفية حسب الرابط (نص جزئي أو تعبير نمطي) أو الطريقة أو وسيلة النقل.
const posts = await device.network.requests({ url: /\/api\//, method: 'POST' });

// ابدأ نافذة التقاط جديدة في منتصف الاختبار.
await device.network.clear();
```

يحمل السجل الحقول `method` و `url` و `status` و `requestHeaders` و `responseHeaders` و `startedAt` و `durationMs`، إضافةً إلى `error` حين يفشل التبادل قبل اكتماله.

### قيم افتراضية يمكنك الاعتماد عليها

- **تُحجب ترويسات الاعتماد.** فتتحوّل `authorization` و `cookie` و `set-cookie` و `x-api-key` إلى `<redacted>` قبل أن يصلك السجل — لأن الحركة الملتقطة تنتهي في سجلات CI وتقارير HTML.
- **يُحدّ حجم الأجسام** عند 64 كيبي بايت، وتُسقَط مع `bodyOmittedReason: 'too-large'`، فلا يستطيع تشغيل طويل تكديس ميغابايتات من الحمولات.
- **يُفرَّغ المخزن بين الاختبارات**، فلا يستطيع اختبار أن يؤكّد على حركة اختبار آخر أبدًا.

ويمكنك تجاوز ذلك عند كل نداء حين تحتاج:

```ts
await device.network.requests({ url: '/api' }, {
  maxBodyBytes: 4096,
  redactHeaders: ['x-tenant-token']
});
```

### القائمة الفارغة تعني «لا حركة»

حيث تكون المراقبة غير متاحة، تُطلق `requests()` الخطأ `NETWORK_OBSERVATION_UNSUPPORTED` بدل أن تعيد `[]`. فالمصفوفة الفارغة يجب أن تعني «لم يُطلب شيء» — وإلا لنجحت `expect(requests).toHaveLength(0)` على كل منصة عاجزة عن الرؤية أصلًا.

## الاعتراض غير متاح بعد

قيمة `capabilities().intercept` هي `false` في كل مكان، و `adapterRequired` يوضّح السبب. فتزييف الطلب أو تأخيره أو إفشاله يعني إمساكه مفتوحًا؛ بينما المُحلّل لا يبلّغ إلا عمّا حدث فعلًا.

وهذا يحتاج محوّلًا صغيرًا اختياريًا داخل التطبيق — وهي المرحلة التالية. ولا يشحن Astur وسيط MITM لتزييف ذلك، عن قصد:

- ‏Android 7 فأعلى يتجاهل شهادات الجذر المثبّتة من المستخدم ما لم يوافق التطبيق عبر `network_security_config`.
- ‏`HttpClient` في Dart يتجاهل وسيط النظام تمامًا ما لم يضبط التطبيق `findProxy`.

أي أن الوسيط يحتاج تعديلات في التطبيق *على أي حال*، ويضيف فوقها انتهاء الشهادات وأعطال TLS كأسباب جديدة لتعطّل اختبارات لا علاقة لها بالموضوع. والمحوّل الصريح هو النسخة الأمينة من المتطلب نفسه.

## جرّبها

بطاقة **Network lab** في الشاشة الرئيسية لتطبيق العرض بـ Flutter تقود واجهة API محلية يستضيفها التطبيق نفسه — طلبات HTTP حقيقية، دون إنترنت، ونتائج ثابتة:

```bash
cd examples
npm run test:android:flutter -- specs/network-observation.test.ts
```

ويشغّل تطبيق العرض بـ React Native **ملف الاختبار نفسه دون تعديل**، مقابل بناء debug:

```bash
# داخل مستودع تطبيق العرض
npx expo start                       # يقدّم أيضًا مسارات /api الخاصة بـ Network lab
npx expo run:android                 # أو: npx expo run:ios

# داخل examples
npm run test:android:rn-debug        # أو: npm run test:ios:rn-debug
```

وتجيب بطاقة Network lab فيه على المسارات الثلاثة نفسها وبالحالات نفسها كما في بناء Flutter — `/api/profile` بـ 200، و `/api/session` بـ 201، و `/api/missing` بـ 404 — وهذا ما يتيح لملف اختبار واحد محايد تجاه المنصة أن يغطّيهما معًا.

أما بناء **release** المشحون من React Native فمُبلِّغه مُستبعَد وقت الترجمة، فتكون `capabilities().observe` بقيمة `false` هناك وتتخطّى ملفات الرصد الأربعة مع ذكر سببها. وهذا هو العقد وهو يعمل، لا فشلًا.

وهناك فخّ يستحق المعرفة: إعدادات release على iOS لا تفرض إعادة التثبيت، فيبقى بناء debug المتروك على المحاكي هو المستخدَم — ويستمر في الرصد. نفّذ `xcrun simctl uninstall <udid> com.astur.demo` قبل العودة.

راجع [Flutter و React Native](../frameworks/) للتفاصيل الخاصة بكل إطار، و[حدود المنصات](../platform-limits/) للمرجع الكامل للحدود.
