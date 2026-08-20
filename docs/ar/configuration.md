# الإعدادات

يتكامل Astur مع Playwright Test عبر `@astur-mobile/test`.

والإعداد الافتراضي صغير عن قصد: اختر منصة وجهازًا وتطبيقًا. ويهيّئ Astur الوكلاء الأصليين المرفقين تلقائيًا، فلا ينبغي لمستخدمي npm بناء عملية وكيل منفصلة أو تثبيتها أو تشغيلها في التشغيلات المحلية العادية.

## إعداد أساسي

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  outputDir: 'test-results/mobile',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/mobile', open: 'never' }],
    ['junit', { outputFile: 'test-results/mobile/results.xml' }]
  ],
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    astur: {
      platform: 'android',
      timeout: 20_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
      },
      keyboard: {
        dismiss: 'auto'
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

## شكل الإعدادات

```ts
type AsturConfig = {
  platform: 'android' | 'ios';
  device?: {
    id?: string;
    name?: string | RegExp;
    kind?: 'emulator' | 'simulator' | 'real';
    avd?: string;
    autoBoot?: boolean;
    headless?: boolean;
    wipeData?: boolean;
    bootTimeout?: number;
    emulatorArgs?: string[];
    cloud?: {
      provider: 'browserstack';
      deviceName?: string;
      osVersion?: string;
      project?: string;
      build?: string;
      appId?: string;
      usernameEnv?: string;
      accessKeyEnv?: string;
    };
  };
  app?: string | {
    path?: string;
    url?: string;
    downloadPath?: string;
    bundleId?: string;
    packageName?: string;
    activity?: string;
  };
  timeout?: number;
  artifactsDir?: string;
  artifacts?: {
    screenshot?: 'off' | 'on' | 'only-on-failure';
    video?: 'off' | 'on' | 'retain-on-failure';
  };
  keyboard?: {
    dismiss?: 'auto' | 'preserve';
  };
  agent?: {
    mode?: 'auto' | 'required' | 'off';
    install?: boolean;
    endpoint?: string;
    launchTimeout?: number;
    commandTimeout?: number;
  };
};
```

## سير العمل الموصى به

استخدم هذا التدرّج لتبنٍّ مستقر:

<ol class="astur-steps">
  <li>ابدأ بلا قسم <code>automation</code> أو <code>agent</code>؛ فـ Astur يعتمد محرّك الوكيل الأصلي افتراضيًا.</li>
  <li>تحقّق من التأكيدات الأصلية ومن موثوقية الإجراءات على تدفّقات تطبيقك الحقيقية.</li>
  <li>ولا تستخدم <code>automation.engine: 'auto'</code> إلا أثناء الانتقال من سلوك ADB/XML القديم.</li>
  <li>ولا تستخدم <code>automation.engine: 'legacy-adb'</code> إلا حين تقارن المسار القديم أو تشخّصه عمدًا.</li>
</ol>

والحقل `device.cloud` مجرّد هيكل مبدئي للتنفيذ السحابي مستقبلًا. أما محاكيات Android المحلية وأجهزة Android الحقيقية ومحاكيات iOS وأجهزة iOS الحقيقية الموصولة بـ USB فقابلة للتشغيل اليوم متى توفّرت أدوات المنصة وإعداد التوقيع المطلوبان.

والقيمة `timeout` هي ميزانية الانتظار الافتراضية لإجراءات محدِّدات Astur وتأكيداتها. ولا تتجاوزها إلا حيث يحتاج عنصر بعينه ميزانية مختلفة:

```ts
await device.getByLabel('Login').tap();
await device.getByLabel('Slow report').tap({ timeout: 60_000 });
```

والتحكم في الاتجاه محايد تجاه المنصة متى دعمه المشغّل المختار:

```ts
await device.setOrientation('landscape');
await device.orientation.portrait();
```

استخدم إنهاء التطبيق وتشغيله لكل اختبار للعزل المعتاد. وأبقِ تثبيت الوكيل الأصلي وبدءه على مستوى جلسة العامل، ما لم تكن تختبر عمدًا سلوك تثبيت الوكيل أو ترحيل بيانات التطبيق.

وتحتاج أجهزة iOS الحقيقية متغيّر بيئة إضافيًا واحدًا لأن Apple تشترط توقيع مشغّل XCUITest:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

وعند التشغيل من المصدر يستطيع Astur استنتاج الفريق من مشروع Xcode الموقّع `agents/ios-xctest-agent`. أما الاستخدام عبر npm المنشور و CI فينبغي أن يضبط `ASTUR_IOS_DEVELOPMENT_TEAM` صراحةً.

ويفضّل Astur نفق USB من Xcode/CoreDevice لجسر وكيل الأجهزة الحقيقية. ولا تضبط `ASTUR_IOS_AGENT_HOST` على عنوان شبكة لجهاز Mac إلا حين تعجز بيئتك عن استخدام ذلك النفق.

## مرجع قدرات بيئة التشغيل

تقع قدرات Astur تحت `use.astur` في Playwright. أما الإعدادات التي تملكها Playwright مثل `testDir` و `timeout` و `workers` و `reporter` و `outputDir` و `screenshot` و `video` و `trace` فتتصرف تمامًا كإعدادات Playwright Test. بينما تصف إعدادات Astur منصة الجوال والجهاز المختار والتطبيق قيد الاختبار والمخرجات الأصلية.

| الحقل | مطلوب | الافتراضي | الوصف |
| --- | --- | --- | --- |
| `platform` | نعم | لا شيء | المنصة المستهدفة: `'android'` أو `'ios'`. |
| `device` | لا | `{}` | يختار محاكيًا أو جهازًا حقيقيًا. وإذا أُغفل، يختار Astur أول جهاز متصل متوافق. |
| `app` | لا | `undefined` | التطبيق قيد الاختبار. يمكن أن يكون نص مسار محلي، أو كائن تطبيق، أو كائن رابط تنزيل، أو بيانات تطبيق مثبّت. |
| `timeout` | لا | `10_000` | ميزانية الانتظار الافتراضية لإجراءات محدِّدات Astur والتأكيدات الأصلية. |
| `artifactsDir` | لا | مجلد مخرجات Playwright ضمن نطاق جلسة عامل Astur | تجاوز متقدّم لمخرجات Astur الأصلية والتطبيقات المنزّلة والمخرجات الأصلية المؤقتة. وينبغي لمعظم المشاريع إغفاله. وتظل لقطات الشاشة والفيديوهات لكل اختبار مرفقةً عبر مخرجات Playwright. |
| `artifacts.screenshot` | لا | `off` | وضع إرفاق لقطة الشاشة الأصلية: `off` أو `on` أو `only-on-failure`. |
| `artifacts.video` | لا | `off` | وضع تسجيل الشاشة الأصلي: `off` أو `on` أو `retain-on-failure`. وتستطيع تشغيلات Android ومحاكي iOS إرفاق فيديو. أما تشغيلات iOS على الأجهزة الحقيقية فتتخطّى التقاط الفيديو وتتابع. |
| `keyboard.dismiss` | لا | `auto` | استراتيجية لوحة المفاتيح البرمجية. تُخفيها `auto` فقط حين تحجب هدف المؤشر؛ بينما تتركها `preserve` مفتوحة. |
| `automation.engine` | لا | `agent` (‏Android و iOS) | محرّك الأتمتة. يستخدم `agent` مسار الوكيل الأصلي، ويسمح `auto` بالعودة إلى المسار القديم أثناء الانتقال (‏Android فقط)، ويفرض `legacy-adb` مسار الصدفة/XML القديم في Android. |
| `automation.legacyFallback` | لا | `never` (ويُضبط تلقائيًا إلى `on-agent-failure` عند `engine: 'auto'`) | يتحكم في ما إذا كان يجوز لـ Astur العودة من الوكيل إلى أدوات المنصة القديمة. |
| `agent.mode` | لا | مشتقّ من `automation.engine` | اسم بديل للتوافق. فـ `required` تكافئ `automation.engine: 'agent'`، و `auto` تسمح بالعودة، و `off` تفرض الأدوات القديمة. |
| `agent.install` | لا | `true` | يتيح لمشغّل المنصة تثبيت وكيله الأصلي وبدءه حيثما كان مدعومًا. وتبدأ التجهيزة جلسة Astur واحدة لكل عامل Playwright، لا واحدة لكل ملف اختبار. استخدم إنهاء التطبيق وتشغيله للعزل المعتاد لكل ملف، واحفظ تصفير بيانات التطبيق أو إعادة تثبيته للاختبارات التي تحتاجه. |
| `agent.endpoint` | لا | `undefined` | نقطة نهاية اختيارية للوكيل الأصلي. تقبل الصيغ `http://` و `https://` و `tcp:host:port` أو `host:port` المجرّدة. |
| `agent.launchTimeout` | لا | ‏Android: `30_000`؛ iOS: `60_000` | ميزانية المهلة لمصافحة الوكيل الأصلي عند بدء الجلسة. |
| `agent.commandTimeout` | لا | ‏Android: `20_000`؛ iOS: `15_000` | ميزانية المهلة لكل أمر من أوامر الوكيل الأصلي. |

ويعتمد Astur الوكيل الأصلي افتراضيًا على المنصتين (`engine: 'agent'`، `agent.mode: 'required'`، `legacyFallback: 'never'`)، فلا تتدهور التفاعلات الأصلية بصمت أبدًا. وعلى Android يمكنك اختيار `automation.engine: 'auto'` للحفاظ على أمان الانتقال — فهي تعود إلى أدوات ADB/XML القديمة فقط حين يعجز الوكيل الأصلي المرفق عن البدء. أما على iOS فوكيل XCUITest إلزامي لقراءة شجرة الواجهة وللإجراءات الأصلية، فلا يوجد مسار احتياطي؛ ويفشل Astur فورًا بدل تشغيل جلسة ناقصة.

وتؤثر قيم المهلات هذه في الموثوقية أكثر من تأثيرها في سرعة الإجراءات. فإجراءات العناصر العادية تكتمل حالما يعود الوكيل الأصلي؛ والمهلة هي الحد الأقصى لبدء وكيل بارد، أو تهيئة محاكي بطيئة، أو تحميل بيانات التطبيق، أو أمر عالق.

## تجاوزات نقطة نهاية الوكيل الأصلي

يُبقي Astur واجهة الاختبار بسيطة ويدفع بالتعقيد إلى طبقة بيئة التشغيل. وينبغي لمعظم المشاريع إغفال `automation` و `agent` كليًا. فإذا كنت تشغّل وكيل منصة بنفسك، فوجّه Astur إليه عبر `use.astur.agent.endpoint` أو عبر متغيّر بيئة المنصة:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

```ts
use: {
  astur: {
    platform: 'android',
    agent: {
      mode: 'auto',
      endpoint: 'tcp:127.0.0.1:8787'
    }
  }
}
```

استخدم `automation.engine: 'agent'` صراحةً في CI على Android حين يجب ألا تعود التفاعلات الأصلية إلى المسار القديم بصمت. أما iOS فيستخدم وضع XCUITest الإلزامي افتراضيًا أصلًا.

## متغيرات بيئة iOS

يعمل Astur جاهزًا على محاكي دون أي متغيرات بيئة. أما ما يلي فيغطي توقيع الأجهزة الحقيقية والتحكم المتقدّم بالوكيل والتنقيح. ومعظم المشاريع لا تضبط سوى `ASTUR_IOS_DEVELOPMENT_TEAM` (للأجهزة الحقيقية).

| المتغيّر | الافتراضي | الغرض |
| --- | --- | --- |
| `ASTUR_IOS_DEVELOPMENT_TEAM` | يُستنتج من مشروع الوكيل عند التشغيل من المصدر | معرّف فريق Apple المستخدم لتوقيع وكيل XCUITest المرفق. **مطلوب للأجهزة الحقيقية.** |
| `ASTUR_IOS_CODE_SIGN_IDENTITY` | تلقائي | يفرض هوية توقيع بعينها لبناء الوكيل. |
| `ASTUR_IOS_ALLOW_PROVISIONING_UPDATES` | مفعّل | اضبطه على `0` لإسقاط `-allowProvisioningUpdates` حين تدير بيئة CI ملفات التعريف بنفسها. |
| `ASTUR_IOS_AGENT_HOST` | نفق CoreDevice عبر USB، ثم عنوان شبكة محلية قابل للوصول | عنوان Mac الذي يتصل به الوكيل على الجهاز. ولا يُضبط إلا حين يتعذّر الوصول إلى الجسر المكتشَف تلقائيًا. |
| `ASTUR_IOS_AGENT_BIND_HOST` | `127.0.0.1` (محاكي) / `0.0.0.0` أو `::` (جهاز حقيقي) | الواجهة التي يرتبط بها جسر المضيف. |
| `ASTUR_IOS_AGENT_PORT` | منفذ حر عشوائي | منفذ مضيف ثابت لجسر الوكيل. |
| `ASTUR_IOS_AGENT_ENDPOINT` | غير مضبوط | الاتصال بوكيل iOS بدأته خارجيًا بدل تهيئة واحد. |
| `ASTUR_IOS_AGENT_PROJECT` | المشروع المرفق `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` | مسار مشروع Xcode مخصّص لوكيل XCUITest. |
| `ASTUR_IOS_AGENT_SCHEME` | `AsturIOSAgent` | المخطّط المستخدم لبناء الوكيل. |
| `ASTUR_IOS_AGENT_DERIVED_DATA` | مسار مؤقت مفتاحه الجهاز ومصدر الوكيل | يتجاوز موقع ذاكرة بناء الوكيل. |
| `ASTUR_IOS_AGENT_START_ATTEMPTS` | `2` (محاكي) / `1` (جهاز حقيقي) | عدد مرات إعادة محاولة بدء الوكيل قبل الفشل. |
| `ASTUR_IOS_AGENT_REAP` | مفعّل | اضبطه على `0` لمنع Astur من قتل جلسات الوكيل المتبقية للجهاز نفسه قبل تشغيل جديد. |
| `ASTUR_IOS_AGENT_TRACE` | معطّل | اضبطه على `1` لتسجيل كل أمر في الجسر (الطابور/التسليم/الاستجابة/المهلة) — وهو أول ما تلجأ إليه حين تتعلّق الجلسة. |
| `ASTUR_ANDROID_APP_FORCE_INSTALL` | معطّل | اضبطه على `1` لإلغاء تثبيت حزمة Android الموجودة ثم تثبيت التطبيق من `--app`/`app.path`. وهذا يمسح بيانات التطبيق ويدعم البنى التي تتشارك معرّف الحزمة بتوقيعات مختلفة. |
| `ASTUR_IOS_APP_FORCE_INSTALL` | معطّل | اضبطه على `1` لإعادة تثبيت التطبيق من `--app`/`app.path` حتى لو كان مثبّتًا أصلًا. |
| `ASTUR_XCRUN` / `ASTUR_XCODEBUILD` | `xcrun` / `xcodebuild` في `PATH` | مسارات مطلقة لأدوات Apple، لتثبيتات Xcode غير القياسية. |

كما تقرأ إعدادات الأمثلة إضافةً إلى ذلك `ASTUR_IOS_DEVICE_KIND` و `ASTUR_IOS_DEVICE_ID` و `ASTUR_IOS_DEVICE_NAME` و `ASTUR_IOS_BUNDLE_ID` و `ASTUR_IOS_APP_PATH` لاختيار جهاز وتطبيق دون تعديل الملف.

## اختيار الجهاز

استخدم `npx astur-mobile devices` لرؤية معرّفات الأجهزة وأسمائها. وفضّل `device.id` لتشغيلات CI الحتمية والمتوازية. واستخدم `device.name` حين يكون اسم المحاكي ثابتًا ولا يُتوقّع سوى جهاز مطابق واحد.

ويختار `platform` المشغّل. أما `device.kind` فلا يختار بين Android و iOS؛ بل يضيّق اختيار الجهاز فقط حين لا يكون `id` محدّدًا بما يكفي، أو حين تريد عمدًا محدِّدًا فضفاضًا مثل «أي محاكي». وإذا ضُبط `device.id`، فأبقِ `kind` حين تريد مرشّحًا تحقّقيًا إضافيًا أو حين تريد أن يتفادى Astur عمل اكتشاف غير ذي صلة، مثل `kind: 'real'` لهاتف iPhone فعلي.

| الحقل | محاكي Android | جهاز Android حقيقي | محاكي iOS | جهاز iOS حقيقي |
| --- | --- | --- | --- | --- |
| `id` | رقم ADB التسلسلي، مثل `emulator-5554` | رقم ADB التسلسلي، مثل `R5CT...` | ‏UDID المحاكي من `simctl` | ‏UDID الجهاز من `devicectl`، مثل `00008030...` |
| `name` | اسم الطراز من `adb devices -l` | اسم الطراز من `adb devices -l` | اسم المحاكي، مثل `iPhone 16 Pro` | اسم الجهاز من `devicectl` |
| `kind` | مرشّح اختياري: `emulator` | مرشّح اختياري: `real` | مرشّح اختياري: `simulator` | مرشّح اختياري: `real` |
| `avd` | اسم الجهاز الافتراضي، مثل `Pixel_9_API_35` | غير مستخدم | غير مستخدم | غير مستخدم |
| `autoBoot` | يُقلع الـ `avd` المضبوط إن لم يكن هناك محاكي مطابق متصل | غير مستخدم | غير مستخدم | غير مستخدم |
| `headless` | يضيف `-no-window` حين يُقلع Astur المحاكي، ما لم يُضبط على `false` | غير مستخدم | غير مستخدم | غير مستخدم |
| `wipeData` | يضيف `-wipe-data` حين يُقلع Astur المحاكي | غير مستخدم | غير مستخدم | غير مستخدم |
| `bootTimeout` | أقصى مدة انتظار لاكتمال إقلاع المحاكي | غير مستخدم | غير مستخدم | غير مستخدم |
| `emulatorArgs` | معاملات إضافية لسطر أوامر المحاكي | غير مستخدم | غير مستخدم | غير مستخدم |
| `cloud` | هيكل BrowserStack المبدئي فقط | هيكل BrowserStack المبدئي فقط | هيكل BrowserStack المبدئي فقط | هيكل BrowserStack المبدئي فقط |

تأتي معرّفات أجهزة Android من:

```bash
adb devices -l
npx astur-mobile devices --android
```

وتأتي معرّفات محاكيات iOS وأجهزتها الحقيقية من:

```bash
xcrun simctl list devices available
xcrun devicectl list devices
npx astur-mobile devices --ios
```

ولأجهزة iOS الحقيقية، اضبط `ASTUR_IOS_DEVELOPMENT_TEAM` واستخدم تطبيقًا موقّعًا للجهاز الموصول. أما وكيل XCUITest المرفق فيبنيه Astur ويشغّله تلقائيًا.

وإذا كان iPhone حقيقي موصولًا عبر USB، يعلن Astur عن نقطة نهاية نفق CoreDevice لمشغّل XCUITest. وتجنّب تثبيت `ASTUR_IOS_AGENT_HOST` يدويًا ما لم يكن جهازك يصل إلى Mac عبر الشبكة المحلية عمدًا.

## وصفات إعداد الأجهزة

محاكي Android باسم الـ AVD مع الإقلاع التلقائي:

```ts
astur: {
  platform: 'android',
  device: {
    kind: 'emulator',
    avd: 'Pixel_9_API_35',
    autoBoot: true,
    headless: true,
    bootTimeout: 120_000
  }
}
```

محاكي Android برقم ADB التسلسلي الحي:

```ts
astur: {
  platform: 'android',
  device: {
    id: 'emulator-5554'
  }
}
```

جهاز iOS حقيقي بالـ UDID:

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

جهاز Android حقيقي برقم ADB التسلسلي:

```ts
astur: {
  platform: 'android',
  device: {
    id: 'R5CT123456A'
  }
}
```

محاكي iOS بالاسم:

```ts
astur: {
  platform: 'ios',
  device: {
    name: 'iPhone 16 Pro'
  }
}
```

محاكي iOS بالـ UDID:

```ts
astur: {
  platform: 'ios',
  device: {
    id: '4E2F2A1D-9B8A-4D41-8E5F-123456789ABC'
  }
}
```

أمثلة على المحدِّدات الفضفاضة في Android:

```ts
// أي محاكي Android متصل.
device: { kind: 'emulator' }

// أي جهاز Android حقيقي متصل.
device: { kind: 'real' }
```

وينبغي للتشغيلات المتوازية على الأجهزة أن تستخدم مشاريع Playwright بقيم `device.id` فريدة:

```ts
projects: [
  {
    name: 'android-phone',
    workers: 1,
    use: { astur: { platform: 'android', device: { id: 'emulator-5554' } } }
  },
  {
    name: 'android-tablet',
    workers: 1,
    use: { astur: { platform: 'android', device: { id: 'emulator-5556' } } }
  }
]
```

ولا تدع مشروعين يختاران الجهاز نفسه. كما حُدّ كل مشروع يخص جهازًا فعليًا بـ `workers: 1`. فقيمة `workers` العليا في Playwright تتحكم في مجمّع العمّال العام، لكنها بلا حدّ لكل مشروع قد تجدول ملفَّي اختبار من مشروع الجوال نفسه في الوقت ذاته. كما ينشئ Astur حجزًا للجهاز على المضيف لكل جلسة عامل ويفشل فورًا إذا حاول عامل ثانٍ حجز الجهاز المضبوط نفسه.

## مرجع قدرات التطبيق

| الحقل | Android | محاكي iOS | الوصف |
| --- | --- | --- | --- |
| `app: './apps/demo.apk'` | نعم | لا | اختصار لمسار تطبيق محلي. وعلى Android يشير إلى حزمة APK. |
| `path` | مسار APK | مسار حزمة `.app` أو `.ipa` متوافق مع المحاكي | التطبيق المحلي الذي يُثبَّت قبل بدء الجلسة. |
| `url` | رابط تنزيل APK | مخطّط له | ينزّل التطبيق أثناء تجهيز القدرات، ثم يثبّته من `downloadPath`. |
| `downloadPath` | اختياري | اختياري | المكان الذي يحفظ فيه Astur تطبيقًا نُزّل من `url`. والافتراضي داخل مجلد المخرجات الأصلية المشتق من Astur. |
| `packageName` | حزمة Android، مثل `com.example` | تُقبل كبديل احتياطي فقط | مطلوب لتشغيل تطبيقات Android المثبّتة أصلًا، ولإلغاء التثبيت، ومسح البيانات أو الذاكرة، ولنداءات دورة الحياة الصريحة. ويُستنتج من حزمة APK متى توفّر `aapt`. |
| `activity` | نشاط تشغيل Android، مثل `.MainActivity` | غير مستخدم | اختياري. وإذا أُغفل، يستخدم Astur نيّة المشغّل في Android عبر `monkey`. |
| `bundleId` | يُقبل كبديل احتياطي فقط | معرّف حزمة iOS، مثل `com.example.demo` | مطلوب لتشغيل iOS وإنهائه وإلغاء تثبيته وتصفيره. |

إعدادات التطبيق الشائعة:

```ts
// Android: تثبيت حزمة APK محلية.
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}

// Android: تنزيل الحزمة أثناء التشغيل.
app: {
  url: 'https://example.com/apps/demo.apk',
  downloadPath: 'test-results/downloads/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}

// Android: التطبيق مثبّت أصلًا على الجهاز.
app: {
  packageName: 'com.example',
  activity: '.MainActivity'
}

// محاكي iOS: تثبيت حزمة .app محلية.
app: {
  path: './apps/Demo.app',
  bundleId: 'com.example.demo'
}

// محاكي iOS: التطبيق مثبّت أصلًا.
app: {
  bundleId: 'com.example.demo'
}
```

## التقارير والمخرجات الأصلية

مُبلِّغات Playwright ومخرجاتها:

| حقل Playwright | الغرض |
| --- | --- |
| `reporter` | يضبط مُبلِّغات HTML أو list أو JUnit أو JSON أو غيرها. |
| `outputDir` | يخزّن تتبّعات Playwright ولقطات الشاشة والفيديوهات ومخرجات الاختبار. |
| `use.screenshot` | سياسة لقطات شاشة Playwright/المتصفح. |
| `use.video` | سياسة فيديو Playwright/المتصفح. |
| `use.trace` | سياسة تتبّع Playwright. |

مخرجات Astur الأصلية:

| حقل Astur | الغرض |
| --- | --- |
| `use.astur.artifactsDir` | تجاوز متقدّم لتخزين المخرجات الأصلية. أغفِله في تشغيلات Playwright العادية؛ إذ يشتق Astur مجلد مخرجات أصلية على نطاق العامل بينما يرفق لقطات الشاشة والفيديوهات لكل اختبار. |
| `use.astur.artifacts.screenshot` | يلتقط لقطات شاشة الجهاز الأصلية عبر ADB/simctl ويرفقها بتقرير Playwright. |
| `use.astur.artifacts.video` | يسجّل شاشة الجهاز الأصلية عبر ADB/simctl ويرفقها أو يحتفظ بها حسب الوضع المضبوط. |

استخدم الطبقتين معًا حين يمزج الاختبار بين أتمتة الجوال الأصلية وأتمتة WebView أو المتصفح.

ويتحكم `use.astur.artifacts` في سياسة الالتقاط الأصلية. وهو منفصل عمدًا عن `use.screenshot` و `use.video` و `use.trace` في Playwright، لأن تلك الإعدادات تنطبق على مخرجات المتصفح والصفحات. ولا تضبط `use.astur.artifactsDir` ما لم تحتج جذر تخزين مخصّصًا؛ فتشغيلات الاختبار العادية ترث بنية مخرجات Playwright لكل اختبار تلقائيًا.

## التأكيدات الأصلية

تعمل `expect` من `@astur-mobile/test` مع محدِّدات Astur الأصلية ومع محدِّدات DOM في Playwright. وتنتظر تأكيدات المحدِّدات الأصلية تلقائيًا وفق `use.astur.timeout` ما لم تُمرَّر مهلة على مستوى المطابِق:

```ts
await expect(device.getByText('Welcome')).toBeVisible();
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('button', { name: 'Submit' })).toBeEnabled({ timeout: 5_000 });
await expect.soft(device.getByText('Optional banner')).toBeHidden();
```

مطابِقات `MobileLocator` الأصلية:

- ‏`toBeVisible` و `toBeHidden` و `toExist`
- ‏`toBeEnabled` و `toBeDisabled` و `toBeSelected` و `toBeFocused`
- ‏`toHaveText` و `toContainText` و `toHaveValue`
- ‏`toHaveLabel` و `toHaveType` و `toHaveBounds`

## التعامل مع لوحة المفاتيح البرمجية

افتراضيًا يعامل Astur لوحة المفاتيح البرمجية كطبقة فوق الجهاز. وتفحص إجراءات المؤشر بالمحدِّدات أو بالإحداثيات ما إذا كانت اللوحة ظاهرة وما إذا كانت تحجب النقطة المستهدفة. فإن حجبتها، أخفاها Astur وانتظر قليلًا حتى يستقر التخطيط، ثم أعاد حلّ المحدِّد قبل النقر أو الضغط المطوّل.

```ts
use: {
  astur: {
    keyboard: {
      dismiss: 'auto'
    }
  }
}
```

استخدم `preserve` حين يتفاعل الاختبار عمدًا مع واجهة لوحة المفاتيح:

```ts
await device.getByLabel('Search').tap({ keyboard: 'preserve' });
```

وللتحكم الصريح، استخدم مساعِد لوحة المفاتيح في الجهاز بدل إرسال مفتاح Back أعمى:

```ts
await device.getByLabel('Password').fill('secret');
await device.keyboard.dismiss();
await device.keyboard.hide(); // اسم بديل لـ dismiss()
await device.keyboard.show(device.getByLabel('Password'));
await device.getByRole('button', { name: 'Sign in' }).tap();
```

وتستخدم التعبئة على iOS الأمر `typeText` من XCTest للقيم الآمنة والقصيرة، ومسارًا مدعومًا باللصق لعمليات الاستبدال الأطول غير الآمنة. ويبقى اللصق متاحًا كخيار صريح حين تريد فرضه لحقل غير آمن بعينه:

```ts
await device.getByLabel('Name').fill('Amr');
await device.getByLabel('Bio').fill('Long local-only text', { textInputMode: 'paste' });
```

## السياقات الأصلية وسياقات WebView

تستخدم الشاشات الأصلية محدِّدات Astur المدعومة بأشجار واجهة المنصة:

```ts
await device.getByLabel('Login').tap();
await expect(device.getByText('Credentials')).toBeVisible();
```

ويمكن قيادة شاشات WebView عبر شجرة DOM في المتصفح. والمسار الموصى به هو `device.webContext()` — وهي واجهة محايدة تجاه المحرّك تعمل **داخل الصفحة** فوق ناقل تنقيح WebView، فتكون محصّنة ضد خنق `requestAnimationFrame` الذي يطبّقه WebView خارج الشاشة (وهو ما يوقف قابلية التنفيذ في Playwright متقطّعًا). وتعمل بالطريقة نفسها مع Flutter و React Native:

```ts
import { expect, test } from '@astur-mobile/test';

test('webview content', async ({ device }) => {
  await device.app.launch();
  await device.getById('tab-web').tap();

  const web = await device.webContext();
  await web.getById('astur-email').fill('qa@astur.dev');
  await web.getById('astur-submit').tap();
  expect(await web.getById('astur-result').textContent()).toMatch(/Submitted/i);

  await web.close();
});
```

وللحصول على كامل سهولة Playwright يمكنك بدلًا من ذلك أخذ مقبض `web.page` عبر تجهيزة `webview` (‏Android فقط — فهي تستخدم Chrome DevTools Protocol، ولذلك يجب أن يفعّل التطبيق تنقيح WebView):

```ts
const web = await webview({ timeout: 30_000 });
await expect(web.page.locator('body')).toContainText(/Astur Web Lab/);
// عروض WebView خارج الشاشة تخنق rAF، ما قد يوقف فحص «الاستقرار» في
// قابلية التنفيذ لدى Playwright — مرّر { force: true } للإجراءات الحساسة
// لـ rAF، أو فضّل device.webContext() أعلاه.
await web.page.getByRole('button', { name: /Submit web form/i }).click({ force: true });
```

وتسرد `device.contexts()` السياقات الأصلية وسياقات WebView. وتعمل `device.webContext()` (جسر DOM المحايد تجاه المحرّك) على **‏Android و iOS — على المحاكي والأجهزة الحقيقية**. أما تجهيزة `webview()` (‏`web.page`) بصفحة Playwright فتبقى **خاصة بـ Android** (إذ تحتاج Chromium CDP)؛ وعلى iOS تُطلق `WEBVIEW_NOT_SUPPORTED` — فاستخدم `device.webContext()` أو المحدِّدات الأصلية هناك. ويبقى الوضع الأصلي متاحًا على المنصتين لأشرطة التنقّل وأزرار النظام والأذونات وسائر واجهات النظام أو التطبيق خارج WebView.

## إدارة التطبيق والجهاز

يكشف Astur دورة حياة التطبيق والأذونات والاتجاه وأوامر حالة الجهاز عبر التجهيزة نفسها.

| الواجهة | Android | محاكي iOS | ملاحظات |
| --- | --- | --- | --- |
| `await device.app.install()` | نعم | نعم | يثبّت `use.astur.app.path` المضبوط. ويتوقع Android حزمة APK، بينما يتوقع iOS ملف `.app` أو IPA متوافقًا مع المحاكي. |
| `await device.app.launch()` | نعم | نعم | يشغّل اسم الحزمة أو معرّفها المضبوط. |
| `await device.app.terminate()` | نعم | نعم | يوقف التطبيق المضبوط دون إلغاء تثبيته. |
| `await device.app.reset({ reinstall: true, launch: true })` | نعم | نعم | يعيد التثبيت من `app.path` ثم يشغّل اختياريًا. استخدمه لبيانات تطبيق نظيفة على محاكي iOS. |
| `await device.app.clearData()` | نعم | لا | مسح بيانات الحزمة في Android. أما iOS فيستخدم التصفير بإعادة التثبيت. |
| `await device.app.clearCache()` | نعم | لا | مسح ذاكرة الحزمة في Android. ولا يوفّر iOS مكافئًا مباشرًا. |
| `await device.app.uninstall()` | نعم | نعم | يزيل التطبيق المضبوط. |
| `await device.permissions.grant('camera')` | نعم | نعم | يستخدم Android أذونات مدير الحِزم، ويستخدم محاكي iOS الأمر `simctl privacy`. |
| `await device.permissions.revoke('camera')` | نعم | نعم | التحويل نفسه كما في المنح. |
| `await device.setOrientation('landscape')` | نعم | نعم | يضبط الاتجاه عبر مشغّل المنصة المختار. |
| `await device.orientation.portrait()` | نعم | نعم | مساعِد للراحة للاتجاه الرأسي. |
| `await device.lock()` | نعم | نعم | يقفل الجهاز أو المحاكي حيثما كان مدعومًا. |
| `await device.unlock()` | نعم | نعم | يوقظ الهدف أو يفتح قفله عند الدعم. |
| `await device.isLocked()` | نعم | نعم | يعيد حالة القفل الملحوظة حين تكشفها المنصة. |

وكل أوامر التطبيق تعتمد `use.astur.app` افتراضيًا. مرّر اسم حزمة أو معرّفها عند إدارة تطبيق مثبّت آخر:

```ts
await device.app.clearData('com.example.other');
await device.app.uninstall('com.example.other');
await device.permissions.grant('photos', 'com.example.other');
```

وينفّذ Android إدارة بيانات التطبيق وذاكرته وأذوناته عبر أوامر مدير الحِزم في ADB. أما محاكي iOS فيدعم التثبيت وإلغاء التثبيت والتشغيل والإنهاء والتصفير بإعادة التثبيت ومنح الأذونات وسحبها عبر `simctl privacy`؛ ولا يكشف `simctl` مسح بيانات أو ذاكرة تطبيق بعينه مباشرةً.

## مساعِدات بيئة التشغيل القابلة لإعادة الاستخدام

يصدّر Astur مساعِدات صغيرة لحسابات كائنات الصفحات الشائعة ولاجتياز اللقطات، كي لا تضطر كائنات صفحات التطبيق إلى تكرارها.

| المساعِد | الاستخدام |
| --- | --- |
| `centerOf(bounds)` | يعيد إحداثي مركز عنصر أو أبعاد الشاشة. |
| `pointInBounds(bounds, xRatio, yRatio)` | يعيد إحداثيًا داخل الأبعاد، مثل `pointInBounds(screen.bounds, 0.5, 0.82)`. |
| `flattenTree(snapshot)` | يسطّح شجرة واجهة أصلية إلى قائمة قابلة للبحث من لقطات العناصر. |
| `findElement(snapshot, selector)` | يطبّق مطابقة محدِّدات Astur على لقطة. مفيد للتشخيص ولقراءات كائنات الصفحات الخاصة بالتطبيق. |

أبقِ المعرفة الخاصة بالتطبيق، مثل «اقرأ عدّاد مختبر النقر»، داخل كائن الصفحة. وأبقِ الهندسة العامة واجتياز الشجرة ومطابقة المحدِّدات في مساعِدات Astur.

## لقطات الشاشة وملفات الجهاز

التقط لقطة شاشة أصلية بصيغة `Buffer`، أو احفظها مباشرةً:

```ts
const image = await device.screenshot();
await device.screenshot({ path: 'test-results/screens/home.png' });
```

واستخدم `device.files` لتحضير الاختبارات وللتشخيص. وعلى Android يستخدم هذا نقل ملفات ADB:

```ts
await device.files.push('./fixtures/avatar.png', '/sdcard/Download/avatar.png');

const logs = await device.files.pull('/sdcard/Download/app.log');
await device.files.save('/sdcard/Download/app.log', 'test-results/device/app.log');

const downloads = await device.files.list('/sdcard/Download');
await device.files.remove('/sdcard/Download/avatar.png');
```

وهذا مفيد لتحضير سيناريوهات منتقي الرفع، وجمع الملفات المولّدة، وحفظ سجلات التطبيق أو صادراته بعد الاختبار. أما نقل الملفات على iOS فغير مكشوف بعد عن قصد، لأنه يحتاج تعاملًا مدركًا لحاوية التطبيق.

## المشاريع عبر المنصات

استخدم مشاريع Playwright:

### شاهد Android و iOS يعملان بالتوازي

<div class="astur-video-card">
  <div class="astur-video-copy">
    <span class="astur-video-kicker">التنفيذ المتوازي</span>
    <strong>‏Android و iOS في تشغيل Playwright واحد.</strong>
    <p>شاهد Astur وهو ينسّق المنصتين في الوقت نفسه بأجهزة معزولة وتدفّق اختبار مشترك.</p>
    <a class="astur-video-link" href="https://youtu.be/H1-cRGLqu2U" target="_blank" rel="noreferrer">شاهد على YouTube <span aria-hidden="true">↗</span></a>
  </div>
  <div class="astur-video-frame">
    <iframe src="https://www.youtube-nocookie.com/embed/H1-cRGLqu2U" title="Astur parallel Android and iOS test execution" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
  </div>
</div>

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  workers: 2,
  projects: [
    {
      name: 'android-pixel',
      use: {
        astur: {
          platform: 'android',
          device: { id: 'emulator-5554' },
          app: {
            path: './apps/demo.apk',
            packageName: 'com.example'
          }
        }
      }
    },
    {
      name: 'ios-sim',
      use: {
        astur: {
          platform: 'ios',
          device: { name: 'iPhone 16 Pro' },
          app: {
            path: './apps/Demo.app',
            bundleId: 'com.example.demo'
          }
        }
      }
    }
  ]
});
```

وللتشغيلات المتوازية، حدّد محدِّدات أجهزة فريدة لكل مشروع:

- محاكي Android مع محاكي Android آخر: استخدم قيم `device.id` مختلفة مثل `emulator-5554` و `emulator-5556`.
- محاكي Android مع جهاز Android حقيقي: فضّل المعرّفات الدقيقة مثل `{ id: 'emulator-5554' }` و `{ id: 'R5CT123456A' }`.
- ‏Android مع iOS: استخدم مشروعي منصة منفصلين بأجهزة فعلية أو افتراضية منفصلة.
- محاكي iOS مع iPhone حقيقي: استخدم قيم `device.id` منفصلة، وتأكد من توقيع تطبيق الجهاز الحقيقي ومشغّل XCUITest.

ويشغّل المثال `examples/config/android/playwright.parallel.config.ts` مشروع Android واحدًا ومشروع محاكي iOS واحدًا بالتوازي. ويستخدم `ASTUR_ANDROID_DEVICE_ID` و `ASTUR_IOS_DEVICE_ID` و `ASTUR_IOS_DEVICE_NAME` و `ASTUR_IOS_BUNDLE_ID` كتجاوزات اختيارية.

ويحجز Astur كل جهاز مضبوط لكل جلسة عامل. فإذا اختار عاملان الجهاز الفعلي نفسه، فشل الثاني بخطأ حجز بدل التنازع الصامت على التطبيق. اضبط قيمة `workers` العليا على عدد الأجهزة المتاحة، وأبقِ محدِّدات المشاريع فريدة، واضبط `workers: 1` داخل كل مشروع يقابل جهازًا فعليًا واحدًا.

ولا يستطيع هاتف واحد أو محاكي واحد تشغيل جلستي تطبيق أصليتين في الوقت نفسه. فالتوازي يأتي من تعدّد الأجهزة: جهازان لعاملين، وثلاثة لثلاثة، وهكذا. وينطبق هذا بالتساوي على محاكيات Android وأجهزته الحقيقية ومحاكيات iOS وأجهزته الحقيقية.

وعند تصفية تشغيل متوازٍ إلى ملف واحد ومشروع واحد، مرّر الملف قبل `--project`:

```bash
npm run test:parallel:spec -- specs/login.test.ts --project ios-simulator
```

فالراية `--project` متغيّرة العدد في Playwright، ولذلك قد يُقرأ ما يليها كاسم مشروع آخر.
