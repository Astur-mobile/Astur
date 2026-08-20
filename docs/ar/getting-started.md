# البدء السريع مع Astur

يمثل Astur حزمة أدوات أتمتة للجوال تعمل مباشرة على الأجهزة، جالبةً معها سرعة ومرونة Playwright Test إلى بيئة الجوال. فهو يتحكم في أجهزة Android وiOS عبر أدوات المنصة الأصلية عوضاً عن الاعتماد على خادم Appium.

استوحي اسم Astur من **الأسطرلاب**: الأداة التاريخية التي بسطت الحسابات الفلكية المعقدة في جهاز صغير يُحمل باليد. وتيمناً بإرث "مريم الأسطرلابية"، يطبق Astur الفلسفة ذاتها في أتمتة الجوال: الحفاظ على بساطة واجهة الاختبار، بينما يتولى الإطار الداخلي المهام الثقيلة مثل إدارة الوكلاء الأصليين، ودورة حياة الأجهزة، والتعامل مع المحددات، والتقاط الصور، وتتبع العمليات، والتفاصيل الدقيقة لكل منصة.

صُمم هذا الدليل ليأخذ بيدك من البداية وصولاً إلى سير عمل يومي وموثوق.

قم بتثبيت Astur في مشروعك عبر npm:

```bash
npm install -D @astur-mobile/test astur-mobile
npx astur-mobile doctor
```

تُكتب جميع الأوامر في هذا الدليل باستخدام واجهة سطر الأوامر (CLI) المتاحة (`npx astur-mobile …`)، مما يضمن عملها بالطريقة نفسها في أي مشروع بعد تثبيت الحزمة.

وإذا كنت تشارك في تطوير Astur من الكود المصدري، فاحرص على تثبيت التبعيات وبناء المشروع أولاً:

```bash
npm install
npm run build
npx astur-mobile doctor
```

## ما الذي ستنجزه هنا؟

بنهاية هذا الدليل، ستكون قادراً على:

- تشغيل أدوات الفحص والتأكد من سلامة بيئة جهازك.
- اكتشاف الأجهزة المستهدفة واختيار الأنسب منها.
- فحص تطبيق يعمل فعلياً واستخراج كود اختبار مبدئي.
- إعداد أول اختبار أصلي لك وتشغيله بنجاح.
- التمييز بين المسار الاحتياطي (Fallback) ونمط الوكيل الأصلي (Native Agent).
- معرفة الخطوات التالية لاحتراف التعامل مع كل منصة.

## 1. فحص بيئة العمل

نفذ الأمر التالي:

```bash
npx astur-mobile doctor
```

يجب أن تظهر لك مخرجات مشابهة لما يلي على نظام macOS:

```text
Astur › doctor
Environment diagnostics

◦ Android
  ✓ PASS ADB
  ✓ PASS Android SDK

◦ iOS
  ✓ PASS Xcode
  ✓ PASS iOS simulators
  ◦ WARN iOS real-device signing
```

تدعم أنظمة Linux وWindows تشغيل Android بشكل كامل. أما بالنسبة لـ iOS، فيتم تخطيه نظراً لأن أتمتته تتطلب نظام macOS وبرنامج Xcode حصراً.

إذا عرض `doctor` تحذيرات بخصوص التوقيع الرقمي لأجهزة iOS الحقيقية، لا تقلق؛ فلا يزال بإمكانك أتمتة المحاكيات. لكن لأتمتة هاتف iPhone حقيقي، يلزمك إعداد `ASTUR_IOS_DEVELOPMENT_TEAM` حتى يتمكن Xcode من توقيع مشغل XCUITest المرفق.

إذا كنت تبدأ العمل على iOS، فاختر المسار الأنسب لهدفك:

- **للاختبار السريع على محاكي أو لكتابة الاختبارات عبر أداة Inspector:** لا يشترط توفر حساب فريق Apple. ما عليك سوى توجيه أداة توليد الكود إلى ملف `.app` الخاص بالمحاكي — 
  `npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp`.
- **لاختبار تطبيقك على محاكي:** قم أولاً ببناء ملف `.app` للمحاكي عبر Xcode، ثم حدد مساره في إعداد `app.path`.
- **للاختبار على جهاز حقيقي:** ستحتاج لملف `.ipa` موقع ومخصص للجهاز، مع إعداد `ASTUR_IOS_DEVELOPMENT_TEAM`.

> هل تفتقر لتطبيق جاهز للبدء؟ التطبيق التجريبي من Astur (`Astur.app` / `astur.demo.ios.ipa` بمعرف `com.astur.demo`) متوفر في مستودع أمثلة Astur، مما يتيح لك تجربة عملية توليد الكود قبل الانتقال لتطبيقك الفعلي.

## 2. اختيار المنصة

يعتمد Astur افتراضياً على مسار الوكيل الأصلي لأتمتة كل من Android، ومحاكيات iOS، وأجهزة iOS الحقيقية المتصلة عبر USB. وفي هذا الوضع، تدير أدوات ADB وXcode دورة حياة التطبيق، بينما يتولى الوكلاء الأصليون مهام البحث عن العناصر، والانتظار، وتنفيذ الإجراءات.

```bash
adb devices -l
npx astur-mobile devices --android
npx astur-mobile devices --ios
```

في حال وجود أجهزة متعددة، يُفضل الاعتماد على المعرفات الدقيقة في الإعدادات لضمان ثبات نتائج الاختبار.

أما لتشغيل الاختبارات بالتوازي عبر منصات مختلفة، فتعامل مع كل هاتف أو محاكي كمورد مخصص لعامل (worker) واحد. قم بإنشاء مشروع Playwright مستقل لكل جهاز، وحدد `workers: 1` داخله، ثم اضبط الحد الأقصى الكلي للعمال (workers) ليتوافق مع عدد الأجهزة التي ترغب في تشغيلها معاً.

## 3. إعداد ملفات المشروع

يتيح لك معالج الإعداد التلقائي إنشاء ملف إعدادات مبدئي، مع نماذج اختبار وملف تعليمات:

```bash
npx astur-mobile init
```

للموافقة التلقائية على القيم الافتراضية:

```bash
npx astur-mobile init --yes
```

الملفات التي سيتم إنشاؤها:

- `playwright.config.ts`
- `tests/example.test.ts`
- `ASTUR_SETUP.md`
- تحديث ملف `.gitignore` ليشمل مخرجات الاختبار.

## 4. ضبط بيئة تشغيل الاختبار

قم بإعداد ملف `playwright.config.ts`. يمتلك Astur قدرة على تشغيل المحاكي واستخراج بيانات حزمة Android تلقائياً من ملف APK:

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/mobile', open: 'never' }]
  ],
  use: {
    astur: {
      platform: 'android',
      timeout: 20_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
      },
      device: {
        kind: 'emulator',
        avd: 'Pixel_9_API_35',
        autoBoot: true,
        headless: true
      },
      app: {
        path: './apps/demo.apk'
      }
    }
  }
});
```

تمثل قيمة `use.astur.timeout` المهلة الافتراضية لانتظار وتأكيد العناصر. وعادة لا تحتاج لتجاوزها إلا في الحالات الاستثنائية:

```ts
await device.getByText('Login').tap();
await device.getByText('Slow report').tap({ timeout: 60_000 });
```

إذا تعذر استخراج بيانات APK تلقائياً في بيئتك، ستحتاج لتمرير اسم الحزمة `packageName` يدوياً، بينما يبقى `activity` اختيارياً:

```ts
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

كما يوفر Astur خيار تحميل التطبيق عبر رابط مباشر أثناء التشغيل:

```ts
app: {
  url: 'https://example.com/apps/demo.apk'
}
```

أو يمكنك توجيهه لاستهداف تطبيق مثبت مسبقاً على الجهاز:

```ts
app: {
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

أما بالنسبة لأجهزة iOS الحقيقية، فالإعدادات مشابهة مع ضرورة إضافة تفاصيل التوقيع الرقمي من Apple:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

```ts
astur: {
  platform: 'ios',
  device: {
    kind: 'real',
    id: '00008030-000548220EF0802E'
  },
  app: {
    path: './apps/Demo.ipa',
    bundleId: 'com.example.demo'
  }
}
```

## 5. الفحص وتوليد الاختبار

تعد أداة Inspector في Astur الطريقة الأسرع للتحقق من الاتصال بالجهاز، وفحص بنية المحددات الأصلية، وتسجيل خطوات الاختبار، ومن ثم استخراج كود مبدئي.

```bash
npx astur-mobile codegen
```

بعض الأوامر الشائعة:

```bash
npx astur-mobile codegen --android --device emulator-5554 --app ./MyApp.apk --app-id com.example.myapp
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
npx astur-mobile codegen --ios --real --device <device-udid> --app ./MyApp.ipa --app-id com.example.myapp
```

من خلال واجهة Inspector:

- انقر على أيقونة الجهاز الحالي في الشريط العلوي للتبديل بين الأجهزة.
- استخدم `Controls` لتثبيت تطبيق (APK/IPA)، تشغيل تطبيق موجود، منح الصلاحيات، تدوير الشاشة، أو قفلها.
- اضغط `Record` للتفاعل مع الشاشة وتسجيل خطواتك، ثم قم بتصديرها بصيغة TypeScript أو JavaScript.

في بعض الحالات على iOS، قد تظهر الشاشة دون إمكانية فحص بنية العناصر، وذلك لأن فحص iOS الأصلي يتطلب معرفة الوكيل لمعرف الحزمة (Bundle ID) الخاص بالتطبيق. لحل ذلك، مرر `--app` و `--app-id` (أو عيّن `ASTUR_IOS_BUNDLE_ID`)، أو استخدم قسم `Controls` لتشغيل التطبيق والاتصال بمعرف الحزمة. وللأجهزة الحقيقية، تأكد من تعيين `ASTUR_IOS_DEVELOPMENT_TEAM`.

لمعرفة المزيد حول سير العمل، راجع [أداة Inspector وتوليد الكود](../inspector/).

## 6. تحديد نقطة اتصال الوكيل الأصلي (خطوة اختيارية)

بشكل افتراضي، يشغل Astur وكلاءه الأصليين أينما كان ذلك متاحاً. ولا داعي لتعيين نقطة اتصال صريحة إلا إذا كنت تقوم بتشغيل الوكيل يدوياً أو تود تشخيص مسار الاتصال.

يتم ضبط القيم الافتراضية مسبقاً، حيث يعتمد كلا النظامين وضع الوكيل الإلزامي (`automation.engine: 'agent'` و `legacyFallback: 'never'`):

- يستعين **Android** بوكيل UIAutomator المدمج. ولا ينبغي استخدام `automation.engine: 'auto'` إلا إذا كنت بحاجة للمسار القديم (ADB/XML) مؤقتاً.
- يستخدم **iOS** وضع XCUITest كخيار إجباري؛ لأن استخراج الواجهة الحية وتفعيل الإجراءات لا يتم بكفاءة بدون هذا الوكيل (ولا يوجد مسار بديل).

مع اعتماد `automation.engine: 'agent'` كوضع قياسي، يتم التعامل مع الأخطاء بصرامة:

- سيفشل الاتصال الأولي إذا تعذرت تهيئة الوكيل.
- وتفشل الأوامر مباشرة إذا تعثر إرسالها عبر الوكيل.

مثال للإعداد:

```ts
use: {
  astur: {
    platform: 'android',
    automation: {
      engine: 'agent'
    },
    agent: {
      endpoint: 'tcp:127.0.0.1:8787'
    }
  }
}
```

كما يمكن ضبط هذه النقاط عبر متغيرات البيئة:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

## 7. كتابة اختبارك الأول

أنشئ ملفاً جديداً `tests/login.test.ts`:

```ts
import { expect, test } from '@astur-mobile/test';

test('login screen is visible', async ({ device }) => {
  await device.app.launch();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

التأكيدات هنا تشبه Playwright تماماً، وتنتظر تلقائياً استناداً لقيمة `use.astur.timeout`:

```ts
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('button', { name: 'Submit' })).toBeEnabled();
await expect.soft(device.getByText('Optional banner')).toBeHidden();
```

## 8. التشغيل

لبدء الاختبارات كافة:

```bash
npx astur-mobile test
```

ولتشغيل ملف اختبار معين:

```bash
npx astur-mobile test tests/login.test.ts
```

## 9. أفضل الممارسات والخطوات القادمة

:::tip[دليلك لضمان موثوقية الاختبارات]

اعتمد هذه النصائح الأساسية لضمان عمل اختباراتك بثبات عند التوسع:

1. أعطِ الأولوية للمحددات الدلالية (`getByLabel`, `getByRole`, `getByTestId`) وتجنب الإحداثيات المباشرة.
2. استخدم معرف الجهاز بدقة `device.id` في بيئات التكامل المستمر (CI).
3. اضبط `use.astur.timeout` ليتناسب واقعياً مع سرعة استجابة تطبيقك.
4. فعل خيار حفظ المخرجات عند الفشل فقط لتقليل المساحة (`screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`).
5. ثبت إغلاق لوحة المفاتيح عبر `keyboard.dismiss: 'auto'` إلا إذا كنت بصدد اختبار واجهة لوحة المفاتيح ذاتها.
6. انتقل لاستخدام الإعداد الإلزامي `agent.mode: 'required'` بمجرد التأكد من كفاءة مسار الوكيل الأصلي.
:::

## 10. إلى أين تتجه بعد ذلك؟

- اكتشف خفايا Android عبر: [إعداد Android](../android/)
- تعرف على تفاصيل iOS عبر: [إعداد iOS](../ios/)
- تعرف على الخيارات المتقدمة في: [الإعدادات](../configuration/)
- ابحث عن حلول للمشاكل المعتادة: [حل المشكلات](../troubleshooting/)
- افهم آلية العمل الداخلية من خلال: [البنية الأساسية](../architecture/)

## ملاحظة حول محاكي iOS

توفر حزمة iOS الدعم لعمليات دورة حياة المحاكي، والتي تشمل:

- عرض قائمة المحاكيات المتاحة.
- تثبيت التطبيقات بصيغة `.app`.
- إطلاق التطبيق وإنهائه باستخدام معرف الحزمة (Bundle ID).
- التقاط صور الشاشة وفتح الروابط.

إلا أن التفاعل مع العناصر الأصلية يشترط وجود وكيل XCUITest المكتوب بـ Swift.

لا يتدخل Astur في عملية بناء التطبيق الخاص بك. لذا إذا أردت الاختبار على محاكي، عليك بناء ملف `.app` عبر Xcode أولاً ثم تحديد مساره باستخدام الخيار `--app`. لتجربة قدرات Astur دون متطلبات بناء إضافية، يُنصح باستخدام التطبيق التجريبي:  
`npx astur-mobile codegen --ios --simulator --app ./Astur.app --app-id com.astur.demo`

إذا تجاهلت إضافة خيار `--app` ولم يكن التطبيق منفذاً مسبقاً، سيفشل التوليد مصدراً الخطأ `IOS_APP_NOT_INSTALLED`. لتلافي ذلك، استخدم `--app` في التشغيل الأول ليتمكن Astur من تنصيبه وتجهيزه للاتصال.

لمزيد من المعلومات الدقيقة، راجع [إعداد iOS](../ios/).
