---
title: "البدء السريع"
description: "ثبّت Astur، افحص تطبيقًا يعمل، ثم شغّل أول اختبار على جهاز حقيقي."
sidebar:
  order: 1
---
‏Astur عُدّة أتمتة للجوال تعمل على الأجهزة مباشرةً، وتنقل سرعة Playwright Test وسهولته إلى مسارات الجوال. وهي تتحكم في Android و iOS عبر أدوات المنصة الأصلية بدل خادم Appium.

الاسم مأخوذ من الأسطرلاب: أداة محمولة اختصرت رصدًا وحسابًا معقّدين في شيء صغير يُمسك باليد. وهو مستوحى كذلك من إرث مريم الأسطرلابية. ويطبّق Astur الفكرة نفسها على اختبار الجوال: يُبقي واجهة الاختبار مضغوطة، بينما يتولّى الإطار خلف الكواليس الوكلاء الأصليين ودورة حياة الأجهزة وترتيب المحدِّدات ولقطات الشاشة والتتبّعات وتفاصيل كل منصة.

صُمّم هذا الدليل لينقلك من الصفر إلى سير عمل يومي موثوق.

ثبّت Astur في مشروعك من npm:

```bash
npm install -D @astur-mobile/test astur-mobile
npx astur-mobile doctor
```

كل أمر في هذه الوثائق مكتوب بصيغة الـ CLI المنشورة (`npx astur-mobile …`)، فيعمل بالطريقة نفسها في أي مشروع بعد تثبيت الحزمة.

أما إذا كنت تطوّر Astur من المصدر، فثبّت اعتماديات مساحة العمل وابنِ أولًا:

```bash
npm install
npm run build
npx astur-mobile doctor
```

## ما الذي ستنجزه

بنهاية هذا الدليل ستكون قد:

- شغّلت التشخيصات وتحققت من بيئة جهازك المضيف
- اكتشفت الأجهزة المستهدفة واخترت بينها
- فحصت تطبيقًا يعمل وولّدت كود اختبار مبدئيًا
- ضبطت أول اختبار أصلي وشغّلته
- فهمت الفرق بين الوضع الاحتياطي ووضع الوكيل الأصلي
- عرفت إلى أين تتجه لإتقان كل منصة

## 1. افحص جهازك المضيف

نفّذ:

```bash
npx astur-mobile doctor
```

الشكل المتوقع للمخرجات على macOS:

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

يدعم Linux و Windows نظام Android محليًا. أما iOS فيُتخطّى لأن أتمتته محليًا تتطلب macOS مع Xcode.

وإذا أظهر `doctor` تحذيرات بشأن توقيع iOS للأجهزة الحقيقية، تبقى أتمتة المحاكي ممكنة. أما أتمتة iPhone حقيقي فتحتاج `ASTUR_IOS_DEVELOPMENT_TEAM` كي يستطيع Xcode توقيع مشغّل XCUITest المرفق.

وإذا كنت تبدأ من iOS، فاختر أقصر مسار يوافق هدفك:

- اختبار سريع على محاكي أو التأليف عبر الـ Inspector: لا يتطلب فريق Apple. وجّه توليد الكود إلى ملف `.app` للمحاكي — `npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp`.
- اختبار تطبيقك على محاكي: ابنِ ملف `.app` للمحاكي في Xcode أولًا، ثم اضبطه في `app.path`.
- الاختبار على جهاز حقيقي: استخدم ملف `.ipa` موقّعًا للجهاز واضبط `ASTUR_IOS_DEVELOPMENT_TEAM`.

> لا يوجد تطبيق جاهز لديك؟ تطبيق العرض من Astur (`Astur.app` / `astur.demo.ios.ipa`، بمعرّف الحزمة `com.astur.demo`) متاح في مستودع أمثلة Astur، فتستطيع تجربة توليد الكود قبل ربط بنائك الخاص.

## 2. اختر منصة

تستخدم أتمتة Android ومحاكي iOS وأجهزة iOS الحقيقية الموصولة بـ USB مسارَ الوكيل الأصلي في Astur افتراضيًا. وما زال ADB وأدوات Xcode يديران دورة الحياة والمخرجات، بينما يتولّى وكلاء المنصة البحث عن المحدِّدات والانتظار والإجراءات.

```bash
adb devices -l
npx astur-mobile devices --android
npx astur-mobile devices --ios
```

إذا ظهرت لديك أجهزة متعددة، فضّل المعرّفات الدقيقة في الإعدادات لتشغيلات حتمية.

وللتشغيل المتوازي عبر المنصات، تعامل مع كل هاتف أو محاكي كمورد بعامل واحد. استخدم مشروع Playwright واحدًا لكل جهاز، واضبط `workers: 1` داخل كل مشروع، ثم اضبط قيمة `workers` العليا على عدد الأجهزة التي تريد تشغيلها في الوقت نفسه.

## 3. جهّز ملفات المشروع

ينشئ معالج الإعداد ملف إعدادات مبدئيًا واختبارات نموذجية وملاحظة إعداد:

```bash
npx astur-mobile init
```

وللقيم الافتراضية دون تفاعل:

```bash
npx astur-mobile init --yes
```

من الملفات المولّدة:

- `playwright.config.ts`
- `tests/example.test.ts`
- `ASTUR_SETUP.md`
- مدخلات `.gitignore` للمخرجات

## 4. اضبط بيئة تشغيل الاختبار

أنشئ `playwright.config.ts`. يستطيع Astur تشغيل المحاكي واستنتاج بيانات حزمة Android من ملف APK:

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

القيمة `use.astur.timeout` هي المهلة الافتراضية لإجراءات العناصر وتأكيداتها على الجوال. ولا تحتاج تجاوزات لكل عنصر إلا في الحالات غير المعتادة:

```ts
await device.getByText('Login').tap();
await device.getByText('Slow report').tap({ timeout: 60_000 });
```

وإذا لم يكن استنتاج بيانات APK متاحًا في بيئتك، فمرّر `packageName`. أما `activity` فاختياري:

```ts
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

ويمكنك أيضًا تنزيل التطبيق أثناء التشغيل:

```ts
app: {
  url: 'https://example.com/apps/demo.apk'
}
```

أو استهداف تطبيق مثبّت على الجهاز أصلًا:

```ts
app: {
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

وإعداد جهاز iOS الحقيقي بالشكل نفسه، مع إضافة إعداد توقيع Apple:

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

## 5. افحص وولّد اختبارًا

الـ Inspector في Astur أسرع طريقة للتأكد من اتصال الجهاز، وفحص المحدِّدات الأصلية، وتسجيل تدفّق قصير، وتصدير اختبار مبدئي.

```bash
npx astur-mobile codegen
```

أمثلة شائعة:

```bash
npx astur-mobile codegen --android --device emulator-5554 --app ./MyApp.apk --app-id com.example.myapp
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
npx astur-mobile codegen --ios --real --device <device-udid> --app ./MyApp.ipa --app-id com.example.myapp
```

داخل الـ Inspector:

- انقر شارة الجهاز الحالي في الترويسة للتبديل بين الأجهزة
- استخدم `Controls` لتثبيت ملف APK/IPA، أو تشغيل تطبيق موجود، أو منح الأذونات، أو تدوير الشاشة، أو قفلها وفتحها
- انقر `Record`، وتفاعل مع الشاشة المعروضة، ثم صدّر TypeScript أو JavaScript

قد تظهر لقطات شاشة iOS حتى عندما تكون شجرة الواجهة غير متاحة. ويتطلب فحص iOS الأصلي أن يعرف وكيل XCUITest معرّف حزمة التطبيق. ولتطبيقك الخاص مرّر `--app` و `--app-id` (أو اضبط `ASTUR_IOS_BUNDLE_ID`)، أو استخدم `Controls` للتشغيل وإعادة الربط بمعرّف الحزمة. وللأجهزة الحقيقية اضبط أيضًا `ASTUR_IOS_DEVELOPMENT_TEAM`.

راجع [الـ Inspector وتوليد الكود](../inspector/) لسير العمل الكامل.

## 6. وضع نقطة نهاية الوكيل الأصلي (اختياري)

يشغّل Astur وكلاءه الأصليين المرفقين افتراضيًا حيثما كان ذلك مدعومًا. ولا يلزم وضع نقطة النهاية إلا إذا كنت تشغّل وكيل منصة بنفسك أو تشخّص سلوك النقل.

القيم الافتراضية لكل منصة مضبوطة مسبقًا في Astur. وكلتا المنصتين تعتمدان وضع الوكيل الإلزامي (`automation.engine: 'agent'`، `legacyFallback: 'never'`):

- يستخدم Android وكيل UIAutomator المرفق. ولا تنتقل إلى `automation.engine: 'auto'` إلا إذا احتجت المسار القديم (ADB/XML) أثناء الانتقال.
- يستخدم iOS وضع XCUITest الإلزامي، لأن قراءة شجرة الواجهة الأصلية وتنفيذ الإجراءات الأصلية لا يعملان بموثوقية دون وكيل XCUITest؛ ولا يوجد مسار احتياطي.

ومع القيمة الافتراضية `automation.engine: 'agent'` لا تتدهور التفاعلات الأصلية بصمت أبدًا:

- تفشل تهيئة الجلسة إذا تعذّرت تهيئة الوكيل
- ويفشل تنفيذ الأوامر فورًا عند فشل نداءات أوامر الوكيل

مثال:

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

كما تُدعم نقاط النهاية عبر متغيرات البيئة:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

## 7. اكتب اختبارًا

أنشئ `tests/login.test.ts`:

```ts
import { expect, test } from '@astur-mobile/test';

test('login screen is visible', async ({ device }) => {
  await device.app.launch();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

التأكيدات الأصلية بأسلوب Playwright وتنتظر تلقائيًا وفق `use.astur.timeout`:

```ts
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('button', { name: 'Submit' })).toBeEnabled();
await expect.soft(device.getByText('Optional banner')).toBeHidden();
```

## 8. شغّل

```bash
npx astur-mobile test
```

ولتشغيل ملف واحد فقط:

```bash
npx astur-mobile test tests/login.test.ts
```

## 9. الخطوات التالية والممارسات

:::tip[قائمة تحقّق لموثوقية أساسية]

استخدم هذه القائمة قبل التوسّع في عدد الاختبارات:

1. فضّل المحدِّدات الدلالية (`getByLabel`, `getByRole`, `getByTestId`) على الإحداثيات.
2. استخدم `device.id` الدقيق في CI.
3. اجعل `use.astur.timeout` واقعيًا بحسب زمن تحميل تطبيقك.
4. فعّل المخرجات الأصلية عند الفشل (`screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`).
5. ثبّت سلوك لوحة المفاتيح عبر `keyboard.dismiss: 'auto'` ما لم تكن واجهة لوحة المفاتيح نفسها قيد الاختبار.
6. انتقل من `agent.mode: 'auto'` إلى `agent.mode: 'required'` بعد التحقق من مسار الوكيل الأصلي.
:::

## 10. إلى أين تتجه بعد ذلك

- تعمّق في Android: [إعداد Android](../android/)
- تعمّق في iOS: [إعداد iOS](../ios/)
- مصفوفة القدرات الكاملة: [الإعدادات](../configuration/)
- الأعطال الشائعة وحلولها: [حل المشكلات](../troubleshooting/)
- نموذج التشغيل عالي المستوى: [البنية](../architecture/)

## محاكي iOS

تدعم حزمة iOS حاليًا دورة حياة المحاكي:

- سرد المحاكيات
- تثبيت ملف `.app`
- التشغيل بمعرّف الحزمة
- الإنهاء بمعرّف الحزمة
- لقطة الشاشة
- فتح الروابط

أما محدِّدات العناصر الأصلية فتتطلب وكيل XCUITest بلغة Swift.

لا يبني Astur تطبيق المحاكي الخاص بك نيابةً عنك. فإذا كنت تختبر تطبيقك على محاكي، فابنِ ملف `.app` للمحاكي في Xcode أولًا ووجّه Astur إلى ذلك المخرج عبر `--app`. ولتجربة Astur دون بناء أي شيء، استخدم تطبيق العرض من مستودع أمثلة Astur: `npx astur-mobile codegen --ios --simulator --app ./Astur.app --app-id com.astur.demo`.

وإذا أغفلت `--app` ولم يكن التطبيق مثبّتًا أصلًا، يفشل توليد الكود بالخطأ `IOS_APP_NOT_INSTALLED`. أدرج `--app` في التشغيل الأول كي يستطيع Astur تثبيت التطبيق قبل الاتصال به.

للتفاصيل، راجع [إعداد iOS](../ios/).
