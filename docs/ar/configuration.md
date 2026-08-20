# الإعدادات

يتكامل Astur بشكل مباشر مع Playwright Test من خلال الحزمة `@astur-mobile/test`.

تم تصميم الإعداد الافتراضي ليكون بسيطاً للغاية ومباشراً: كل ما عليك هو تحديد المنصة، والجهاز، والتطبيق المراد اختباره. سيتكفل Astur تلقائياً بتهيئة الوكلاء الأصليين (Native Agents) المدمجين؛ لذا لن يضطر مستخدمو npm إلى بناء، أو تثبيت، أو تشغيل عملية الوكيل بشكل منفصل في بيئات التشغيل المحلية المعتادة.

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

## هيكل الإعدادات

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

نوصي باتباع هذا التسلسل لضمان تبنٍ سلس ومستقر للإطار:

<ol class="astur-steps">
  <li>ابدأ الإعداد دون تخصيص قسمي <code>automation</code> أو <code>agent</code>؛ حيث يعتمد Astur محرك الوكيل الأصلي كخيار افتراضي.</li>
  <li>تأكد من نجاح التأكيدات الأصلية وموثوقية الإجراءات عبر محاكاة مسارات الاستخدام الحقيقية لتطبيقك.</li>
  <li>اقتصر على استخدام <code>automation.engine: 'auto'</code> فقط خلال مرحلة الانتقال من سلوكيات مسار ADB/XML القديم.</li>
  <li>تجنب استخدام <code>automation.engine: 'legacy-adb'</code> إلا إذا كنت تقارن أداء المسار القديم أو تُشخّصه قصداً.</li>
</ol>

يُعتبر الحقل `device.cloud` حالياً مجرد هيكل مبدئي استعداداً لدعم التنفيذ السحابي مستقبلاً. في المقابل، يدعم Astur التشغيل الكامل لمحاكيات Android، وأجهزة Android الحقيقية، ومحاكيات iOS، بالإضافة إلى أجهزة iOS الحقيقية المتصلة عبر USB، شريطة توفر أدوات المنصة المطلوبة وإعدادات التوقيع اللازمة.

تمثل القيمة `timeout` مهلة الانتظار الافتراضية لكل من إجراءات المحددات وتأكيداتها. ولا يُنصح بتجاوز هذه القيمة إلا إذا استدعى عنصر معين مهلة زمنية مختلفة:

```ts
await device.getByLabel('Login').tap();
await device.getByLabel('Slow report').tap({ timeout: 60_000 });
```

أما التحكم في اتجاه الشاشة (Orientation) فهو محايد المنصة، ويعمل طالما كان المشغل المختار يدعمه:

```ts
await device.setOrientation('landscape');
await device.orientation.portrait();
```

لضمان العزل القياسي، احرص على إنهاء التطبيق ثم إعادة تشغيله عند بدء كل اختبار. ومن الأفضل الحفاظ على عملية تثبيت وبدء الوكيل الأصلي على مستوى جلسة العامل (Worker)، ما لم يكن هدفك الصريح اختبار سلوك عملية تثبيت الوكيل أو تقييم كيفية ترحيل بيانات التطبيق.

تتطلب أجهزة iOS الحقيقية تحديد متغير بيئة إضافي، نظراً لأن Apple تشترط توقيع مشغل XCUITest رقمياً:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

عند تشغيل Astur من الكود المصدري، يمكنه استنتاج فريق التطوير تلقائياً من مشروع Xcode الموقع والموجود في `agents/ios-xctest-agent`. أما عند استخدامه عبر حزمة npm المنشورة أو في بيئات التكامل المستمر (CI)، فيلزم تعيين `ASTUR_IOS_DEVELOPMENT_TEAM` صراحةً.

يُفضل Astur تمرير البيانات عبر نفق USB مستخدماً Xcode/CoreDevice للاتصال بوكيل الأجهزة الحقيقية. لذلك، لا تلجأ لتعيين `ASTUR_IOS_AGENT_HOST` بعنوان شبكة للـ Mac إلا في الحالات التي لا تتمكن فيها بيئتك من استخدام النفق المذكور.

## مرجع قدرات بيئة التشغيل

تندرج قدرات Astur ضمن قسم `use.astur` في إعدادات Playwright. أما الإعدادات الخاصة بـ Playwright نفسها (مثل `testDir`، `timeout`، `workers`، `reporter`، `outputDir`، `screenshot`، `video`، و `trace`) فتعمل كالمعتاد وفق آليتها المعهودة. بينما تُعنى إعدادات Astur بتحديد منصة الجوال، الجهاز المختار، التطبيق قيد الاختبار، والمخرجات الأصلية (Artifacts).

| الحقل | مطلوب؟ | القيمة الافتراضية | الوصف |
| --- | --- | --- | --- |
| `platform` | نعم | - | المنصة المستهدفة للاختبار: `'android'` أو `'ios'`. |
| `device` | لا | `{}` | لاختيار محاكي أو جهاز حقيقي. عند إغفاله، يختار Astur أول جهاز متوافق متصل. |
| `app` | لا | `undefined` | التطبيق قيد الاختبار. يمكن أن يُحدد كمسار محلي، رابط تنزيل، كائن يحتوي على خصائص التطبيق، أو تفاصيل لتطبيق مُثبّت. |
| `timeout` | لا | `10_000` | مهلة الانتظار الافتراضية بالملي ثانية لإجراءات محددات Astur والتأكيدات الأصلية. |
| `artifactsDir` | لا | مجلد مخرجات Playwright لكل عامل | إعداد متقدم لتجاوز المسار الافتراضي لحفظ المخرجات الأصلية والتطبيقات المنزلة. في العادة، يجب إغفاله، حيث يدمج Astur صوره وفيديوهاته تلقائياً في تقارير Playwright. |
| `artifacts.screenshot` | لا | `off` | إعدادية التقاط صور شاشة الجهاز الأصلية. القيم الممكنة: `off`، `on`، أو `only-on-failure`. |
| `artifacts.video` | لا | `off` | إعدادية تسجيل شاشة الجهاز الأصلية. القيم الممكنة: `off`، `on`، أو `retain-on-failure`. (تُستثنى الأجهزة الحقيقية لـ iOS وتتخطى التصوير لضمان الاستمرارية). |
| `keyboard.dismiss` | لا | `auto` | آلية التعامل مع لوحة المفاتيح الافتراضية. تخفيها قيمة `auto` عند إعاقتها للنقطة المستهدفة، بينما تبقيها `preserve` مفتوحة. |
| `automation.engine` | لا | `agent` | محرك الأتمتة المعتمد. `agent` لتفعيل الوكيل الأصلي، و `auto` للانتقال التدريجي من المسار القديم (Android فقط)، بينما `legacy-adb` يفرض مسار الـ XML القديم. |
| `automation.legacyFallback` | لا | `never` | يحدد ما إذا كان مسموحاً لـ Astur العودة لاستخدام أدوات المنصة القديمة في حال فشل الوكيل الأصلي. تُضبط على `on-agent-failure` تلقائياً إذا كان המחرك `auto`. |
| `agent.mode` | لا | مشتق من `automation.engine` | اسم بديل للتوافق السريع: `required` توافق محرك الوكيل، `auto` يسمح بالمسار البديل، و `off` يفرض الأدوات القديمة. |
| `agent.install` | لا | `true` | يسمح للإطار بتثبيت الوكيل الأصلي وبدئه. يخصص Astur جلسة واحدة للوكيل لكل عامل Playwright، لذا يُنصح بإنهاء وإعادة إقلاع التطبيق لضمان العزل بدلاً من إعادة تثبيت الوكيل المتكررة. |
| `agent.endpoint` | لا | `undefined` | يحدد نقطة اتصال الوكيل الأصلي بشكل اختياري. يقبل تنسيقات: `http://`، `https://`، `tcp:host:port`، أو `host:port`. |
| `agent.launchTimeout` | لا | Android: `30_000`<br>iOS: `60_000` | مهلة الانتظار (بالملي ثانية) لنجاح مصافحة الاتصال مع الوكيل عند بدء الجلسة. |
| `agent.commandTimeout` | لا | Android: `20_000`<br>iOS: `15_000` | مهلة الانتظار (بالملي ثانية) لكل أمر يُرسل للوكيل الأصلي. |

يعتمد Astur مسار الوكيل الأصلي بصفة أساسية لكلتا المنصتين (`engine: 'agent'`، `agent.mode: 'required'`، `legacyFallback: 'never'`) لضمان ألا تتدهور التفاعلات الأصلية بشكل خفي. في نظام Android، لك حرية اختيار `automation.engine: 'auto'` إذا أردت الحفاظ على أمان الانتقال التدريجي بحيث يُفعل أدوات ADB/XML القديمة في حال فشل الوكيل في البدء. في المقابل، وكيل XCUITest في نظام iOS هو وكيل إجباري لقراءة شجرة الواجهة وتنفيذ الإجراءات الأصلية (لا يوجد مسار احتياطي)؛ وعليه سيفشل Astur فوراً بدلاً من تشغيل جلسة غير متكاملة.

تُعد قيم المهل (Timeouts) المذكورة حاسمة في تحقيق الموثوقية أكثر من تأثيرها في سرعة التنفيذ ذاتها. فالإجراءات الاعتيادية تُنجز فور تلقي رد الوكيل؛ بينما تُمثل المهلة سقفاً زمنياً يُغطي بدء وكيل جديد كلياً، أو تهيئة بطيئة للمحاكي، أو تحميل مكثف لبيانات التطبيق، أو لمعالجة الأوامر العالقة.

## تجاوز نقطة اتصال الوكيل الأصلي

يُصمم Astur واجهة الاختبار لتبقى بسيطة قدر الإمكان، مع توجيه التعقيدات نحو طبقة بيئة التشغيل. بالنسبة لمعظم المشاريع، لا داعي للتدخل في إعدادات `automation` و `agent`. ولكن، إذا كنت تُشغّل وكيل منصة بطريقة مستقلة، وجه Astur للاتصال به عبر خاصية `use.astur.agent.endpoint` أو بتعيين متغير البيئة الخاص بالمنصة:

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

استخدم `automation.engine: 'agent'` بشكل صريح في خوادم التكامل المستمر (CI) الخاصة بـ Android للتأكد من ألا تعود التفاعلات بصمت إلى المسار القديم. أما في iOS، فالوكيل XCUITest أساسي وإلزامي.

## متغيرات بيئة iOS

يعمل Astur بسلاسة تامة على المحاكي دون الحاجة لأية متغيرات بيئة مسبقة. تستهدف القائمة التالية إدارة توقيع التطبيقات على الأجهزة الحقيقية، فضلاً عن التحكم المتقدم بالوكيل وعمليات التنقيح. يكفي لمعظم المشاريع أن تضبط متغير `ASTUR_IOS_DEVELOPMENT_TEAM` فقط (عند استخدام أجهزة حقيقية).

| المتغير | القيمة الافتراضية | الغرض |
| --- | --- | --- |
| `ASTUR_IOS_DEVELOPMENT_TEAM` | يُستنتج من المشروع عند توفره | معرّف فريق Apple المستخدَم لتوقيع وكيل XCUITest المرفق. **(إلزامي للأجهزة الحقيقية)**. |
| `ASTUR_IOS_CODE_SIGN_IDENTITY` | آلي (تلقائي) | لفرض هوية توقيع محددة ومخصصة لبناء الوكيل. |
| `ASTUR_IOS_ALLOW_PROVISIONING_UPDATES` | مفعّل | اضبطه على `0` لإلغاء إدراج `-allowProvisioningUpdates` متى كانت بيئة CI تدير ملفات التعريف بشكل مستقل. |
| `ASTUR_IOS_AGENT_HOST` | عبر نفق CoreDevice، ثم الشبكة المحلية | عنوان الآلة المضيفة (Mac) التي سيتصل بها الوكيل. لا يُستخدم إلا إن فشل الاتصال التلقائي عبر النفق المكتشف. |
| `ASTUR_IOS_AGENT_BIND_HOST` | `127.0.0.1` للمحاكي / `0.0.0.0` أو `::` للجهاز الحقيقي | واجهة الاتصال (Interface) التي يرتبط بها جسر المضيف. |
| `ASTUR_IOS_AGENT_PORT` | منفذ عشوائي متاح | تحديد منفذ ثابت للاتصال بجسر الوكيل. |
| `ASTUR_IOS_AGENT_ENDPOINT` | غير مضبوط | لاستخدام وكيل iOS تم تشغيله بشكل خارجي مسبقاً عوضاً عن تهيئة وكيل جديد. |
| `ASTUR_IOS_AGENT_PROJECT` | `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` | مسار مشروع Xcode مخصص يحتوي على الوكيل. |
| `ASTUR_IOS_AGENT_SCHEME` | `AsturIOSAgent` | المخطط المعتمد لبناء الوكيل. |
| `ASTUR_IOS_AGENT_DERIVED_DATA` | مسار مؤقت مبني على الجهاز ومصدر الوكيل | لتجاوز مجلد تخزين بيانات البناء المؤقتة (Derived Data) الخاص بالوكيل. |
| `ASTUR_IOS_AGENT_START_ATTEMPTS` | `2` للمحاكي / `1` للجهاز الحقيقي | الحد الأقصى لمحاولات تشغيل الوكيل قبل إعلان الفشل. |
| `ASTUR_IOS_AGENT_REAP` | مفعّل | اضبطه على `0` لمنع Astur من إنهاء جلسات الوكيل المعلقة لنفس الجهاز قبل بدء دورة اختبار جديدة. |
| `ASTUR_IOS_AGENT_TRACE` | معطّل | اضبطه على `1` لتوثيق وتتبع كل أمر يعبر الجسر (التوجيه، التسليم، الاستجابة، والمهلة). خطوة أولى ممتازة لتشخيص الجلسات المتعثرة. |
| `ASTUR_ANDROID_APP_FORCE_INSTALL` | معطّل | اضبطه على `1` لفرض إلغاء تثبيت الحزمة وإعادة التثبيت من جديد. مفيد لتصفير البيانات بالكامل وحل مشكلات توافق التوقيعات المختلفة لنفس الحزمة في Android. |
| `ASTUR_IOS_APP_FORCE_INSTALL` | معطّل | اضبطه على `1` لفرض إعادة تثبيت التطبيق من المسار المحدد عبر `--app`/`app.path` على الرغم من تواجده مسبقاً. |
| `ASTUR_XCRUN` / `ASTUR_XCODEBUILD` | `xcrun` / `xcodebuild` من مسار النظام | مسارات مطلقة مخصصة لأدوات Apple؛ تُستخدم في حال كانت تثبيتات Xcode ذات طبيعة غير اعتيادية. |

علاوة على ذلك، تستطيع المشاريع قراءة وتطبيق المتغيرات `ASTUR_IOS_DEVICE_KIND`، `ASTUR_IOS_DEVICE_ID`، `ASTUR_IOS_DEVICE_NAME`، `ASTUR_IOS_BUNDLE_ID`، و `ASTUR_IOS_APP_PATH` لتمرير تفاصيل الجهاز والتطبيق دون الحاجة لتعديل الملفات المصدريّة.

## اختيار الجهاز المستهدف

استعن بالأمر `npx astur-mobile devices` لاستعراض معرفات وأسماء الأجهزة المتاحة. يُنصح بالاعتماد على خاصية `device.id` في بيئات التكامل المستمر (CI) وللتنفيذ المتوازي لضمان دقة الاختيار وحتميته. في حين يمكنك الاستعانة بالاسم `device.name` إذا كان اسم المحاكي ثابتاً ولا يُتوقع وجود أكثر من جهاز مطابق.

يقوم الحقل `platform` باختيار المشغل المناسب للبيئة؛ في حين لا يُعنى حقل `device.kind` بالتفريق بين Android و iOS، بل تنحصر مهمته في تضييق نطاق البحث إن كان المعرّف `id` غير دقيق، أو متى رغبت بتطبيق فلتر عام كمصطلح "أي محاكي". ومع تحديد `device.id`، حافظ على تمرير الـ `kind` إذا أردت توثيق الاستهداف أو تجنيب Astur القيام باكتشاف أجهزة غير متوافقة (مثلاً: تعيين `kind: 'real'` لاستهداف هاتف iPhone حقيقي بشكل حصري).

| الحقل | محاكي Android | جهاز Android حقيقي | محاكي iOS | جهاز iOS حقيقي |
| --- | --- | --- | --- | --- |
| `id` | رقم تسلسلي (ADB)، كـ `emulator-5554` | رقم تسلسلي (ADB)، كـ `R5CT...` | معرف المحاكي (UDID) عبر `simctl` | معرف الجهاز (UDID) عبر `devicectl` |
| `name` | اسم الطراز حسب المخرجات لـ `adb devices -l` | اسم الطراز حسب المخرجات لـ `adb devices -l` | اسم المحاكي الفعلي (مثال: `iPhone 16 Pro`) | اسم الجهاز عبر `devicectl` |
| `kind` | فلتر اختياري: `emulator` | فلتر اختياري: `real` | فلتر اختياري: `simulator` | فلتر اختياري: `real` |
| `avd` | اسم جهاز Android الافتراضي (مثال: `Pixel_9_API_35`) | لا يُستخدم | لا يُستخدم | لا يُستخدم |
| `autoBoot` | يطلق جهاز الـ `avd` إذا لم يجد محاكياً مطابقاً نشطاً | لا يُستخدم | لا يُستخدم | لا يُستخدم |
| `headless` | يُلحق معامل `-no-window` أثناء الإقلاع ما لم يتم تعطيله صراحة بـ `false` | لا يُستخدم | لا يُستخدم | لا يُستخدم |
| `wipeData` | يُلحق معامل `-wipe-data` عند إقلاع المحاكي لمسح بياناته السابقة | لا يُستخدم | لا يُستخدم | لا يُستخدم |
| `bootTimeout` | سقف الانتظار الأقصى لاكتمال إقلاع المحاكي | لا يُستخدم | لا يُستخدم | لا يُستخدم |
| `emulatorArgs` | معاملات تنفيذية إضافية تُمرر لسطر أوامر المحاكي | لا يُستخدم | لا يُستخدم | لا يُستخدم |
| `cloud` | (هيكل تنفيذي مبدئي لمنصة BrowserStack فقط) | - | - | - |

مصادر استخراج معرفات أجهزة Android:

```bash
adb devices -l
npx astur-mobile devices --android
```

مصادر استخراج معرفات محاكيات وأجهزة iOS:

```bash
xcrun simctl list devices available
xcrun devicectl list devices
npx astur-mobile devices --ios
```

لاختبار جهاز iOS حقيقي، لا تنسَ تعيين `ASTUR_IOS_DEVELOPMENT_TEAM` والتأكد من استخدام تطبيق مصدّق وموقّع للجهاز المتصل. في هذه الأثناء، يقوم Astur تلقائياً ببناء وتشغيل وكيل XCUITest المرفق.

عند اتصال هاتف iPhone بحاسوبك عبر الـ USB، يؤسس Astur نقطة اتصال لنفق CoreDevice المخصص لمشغل XCUITest، مما يُغني عن الحاجة لتعيين المتغير `ASTUR_IOS_AGENT_HOST` يدوياً، إلا إن كان مسار الاتصال معتمد كلياً على بيئة شبكتك المحلية.

## نماذج لوصفات إعداد الأجهزة

لإعداد محاكي Android وفق اسم (AVD) مع تشغيل الإقلاع التلقائي:

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

لإعداد محاكي Android بناءً على رقمه التسلسلي الحي (ADB):

```ts
astur: {
  platform: 'android',
  device: {
    id: 'emulator-5554'
  }
}
```

لإعداد جهاز iOS حقيقي بمعرّف (UDID):

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

لإعداد جهاز Android حقيقي برقمه التسلسلي (ADB):

```ts
astur: {
  platform: 'android',
  device: {
    id: 'R5CT123456A'
  }
}
```

لإعداد محاكي iOS باستخدام الاسم:

```ts
astur: {
  platform: 'ios',
  device: {
    name: 'iPhone 16 Pro'
  }
}
```

لإعداد محاكي iOS بمعرّف (UDID):

```ts
astur: {
  platform: 'ios',
  device: {
    id: '4E2F2A1D-9B8A-4D41-8E5F-123456789ABC'
  }
}
```

أمثلة للمحددات الفضفاضة أو الاستهدافات العامة في Android:

```ts
// يقبل أي محاكي Android متاح
device: { kind: 'emulator' }

// يقبل أي جهاز Android حقيقي متصل
device: { kind: 'real' }
```

يجب على المشاريع المخصصة للتشغيل المتوازي الاعتماد على محددات `device.id` متفردة لكل مشروع Playwright:

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

احرص على عدم تشارك مشروعين لنفس الجهاز المستهدف، وقيد كل مشروع مخصص لجهاز فعلي بعامل واحد فقط `workers: 1`. على الرغم من أن إعدادات `workers` في Playwright تحدد العدد الكلي للعمال في حوض التشغيل العام، إلا أنها لا تمنع (غيابياً) جدولة اختباريْن من نفس المشروع في آن واحد. وللتصدي لذلك، يعمد Astur إلى إنشاء آلية حجز فردية لكل جهاز مقترنة بجلسة عامل محددة؛ وسيفشل مباشرة إذا حاول عامل آخر التدخل وحجز نفس الجهاز.

## مرجع قدرات التطبيق

| الحقل | Android | محاكي iOS | الوصف |
| --- | --- | --- | --- |
| `app: './apps/demo.apk'` | مدعوم | غير مدعوم | اختصار يعبر عن مسار التطبيق المحلي. في Android، يمثل مسار ملف APK. |
| `path` | مسار لـ APK | مسار حزمة `.app` أو `.ipa` متوافقة مع المحاكي | التطبيق المحلي المراد تنصيبه وتجهيزه قبل الانطلاق بالجلسة. |
| `url` | رابط تنزيل لـ APK | (تحت التطوير) | يُمكّن من تنزيل التطبيق أثناء التهيئة وتثبيته من `downloadPath`. |
| `downloadPath` | اختياري | اختياري | المسار المخصص لحفظ التطبيق المنزّل عبر `url`. الافتراضي هو مسار ضمن مجلد المخرجات الأصلية الخاص بـ Astur. |
| `packageName` | كـ `com.example` | مسار بديل للحزمة | ضروري لإدارة التطبيقات المثبتة سلفاً، الإزالة، ومسح البيانات في Android. يمكن لـ Astur استنتاجه من APK في حال توافر أداة `aapt`. |
| `activity` | كـ `.MainActivity` | لا يُستخدم | اختياري في Android. وإذا أُغفل، يستخدم Astur آلية تشغيل عبر النية الافتراضية باستخدام `monkey`. |
| `bundleId` | مسار بديل | كـ `com.example.demo` | مطلوب لإطلاق وإيقاف وتصفير التطبيق في بيئة iOS. |

بعض إعدادات التطبيق المألوفة:

```ts
// Android: لتثبيت حزمة APK محلية.
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}

// Android: التنزيل المباشر أثناء التشغيل.
app: {
  url: 'https://example.com/apps/demo.apk',
  downloadPath: 'test-results/downloads/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}

// Android: لاستهداف تطبيق مثبت سلفاً على الجهاز.
app: {
  packageName: 'com.example',
  activity: '.MainActivity'
}

// محاكي iOS: لتثبيت حزمة .app محلية.
app: {
  path: './apps/Demo.app',
  bundleId: 'com.example.demo'
}

// محاكي iOS: لتطبيق مثبت سلفاً.
app: {
  bundleId: 'com.example.demo'
}
```

## التقارير والمخرجات الأصلية (Artifacts)

إعدادات مُبلّغات (Reporters) ومخرجات Playwright:

| حقل Playwright | الغرض أو الهدف |
| --- | --- |
| `reporter` | لتهيئة شكل التقارير كمخرجات HTML، list، JUnit، أو JSON وخلافه. |
| `outputDir` | الدليل المخصص لاحتواء تتبعات Playwright، لقطات الشاشة، الفيديوهات ومخرجات الجلسة. |
| `use.screenshot` | يحدد سياسة التقاط الشاشات الخاصة بالمتصفح أو Playwright. |
| `use.video` | سياسة توثيق الفيديو الخاصة بـ Playwright. |
| `use.trace` | سياسة تسجيل مسار التتبع الخاص بـ Playwright. |

مخرجات Astur الأصلية:

| حقل Astur | الغرض أو الهدف |
| --- | --- |
| `use.astur.artifactsDir` | مسار لتجاوز التخزين الافتراضي لمخرجات Astur الأصلية. يُستحسن تركه فارغاً في الغالب؛ ليتولى الإطار إنشاء دليل مخرجات منبثق عن العامل متكفلاً بإرفاق المخرجات بالتقرير النهائي. |
| `use.astur.artifacts.screenshot` | تفعيل التقاط لقطات الشاشة الأصلية للجهاز بالاعتماد على أوامر ADB أو simctl وإرفاقها بتقرير Playwright. |
| `use.astur.artifacts.video` | تفعيل تسجيل فيديو للشاشة الأصلية باستخدام ADB أو simctl وحفظها وفق الوضع المحدد. (في أجهزة iOS الحقيقية، يُتخطى التسجيل وتستمر الجلسة بشكل طبيعي). |

عندما يتطلب اختبارك المزج بين الأتمتة الأصلية للموبايل وأتمتة الويب أو الـ WebView، يمكنك الاستفادة من كلا الطبقتين معاً.

تجدر الإشارة إلى أن `use.astur.artifacts` ينظم سياسات الالتقاط الأصلية للجوال حصراً، وهو مفصول بشكل مقصود عن خصائص `use.screenshot`، و `use.video`، و `use.trace` التابعة لـ Playwright (والمختصة بمتصفحات الويب). لا تُعدل `use.astur.artifactsDir` ما لم تكن بحاجة ماسة لمسار تخزين مستقل؛ إذ تستمد الاختبارات الاعتيادية بنيتها تلقائياً من إعدادات Playwright العامة.

## التأكيدات الأصلية (Assertions)

تمتاز أداة التأكيد `expect` المدمجة من الحزمة `@astur-mobile/test` بدعمها لمحددات Astur الأصلية بنفس كفاءة تفاعلها مع محددات الـ DOM الخاصة بـ Playwright. وتنتظر تأكيدات هذه المحددات بطبيعتها ضمن النطاق الزمني لـ `use.astur.timeout`، ما لم يتم تمرير مهلة متخصصة كمعامل إضافي:

```ts
await expect(device.getByText('Welcome')).toBeVisible();
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('button', { name: 'Submit' })).toBeEnabled({ timeout: 5_000 });
await expect.soft(device.getByText('Optional banner')).toBeHidden();
```

بعض المطابقات (Matchers) الأساسية الخاصة بـ `MobileLocator`:

- `toBeVisible` و `toBeHidden` و `toExist`
- `toBeEnabled` و `toBeDisabled` و `toBeSelected` و `toBeFocused`
- `toHaveText` و `toContainText` و `toHaveValue`
- `toHaveLabel` و `toHaveType` و `toHaveBounds`

## التعامل مع لوحة المفاتيح الافتراضية

يعالج Astur لوحة المفاتيح الافتراضية افتراضياً وكأنها طبقة تعلو واجهة الجهاز. وتدقق إجراءات التفاعل مع المحددات أو الإحداثيات ما إذا كانت لوحة المفاتيح مرئية وتعترض مسار الهدف؛ فإن حدث ذلك، يخفيها Astur وينتظر لبرهة حتى يستقر عرض العناصر قبل محاولة النقر مجدداً.

```ts
use: {
  astur: {
    keyboard: {
      dismiss: 'auto'
    }
  }
}
```

استخدم الخيار `preserve` إذا كان سياق الاختبار يستدعي إبقاء لوحة المفاتيح مفتوحة والتفاعل مع أزرارها عمداً:

```ts
await device.getByLabel('Search').tap({ keyboard: 'preserve' });
```

للحصول على تحكم كامل وأكثر أماناً، استخدم مساعِدات لوحة المفاتيح بدلاً من ضغط زر (رجوع/Back) بصورة عمياء:

```ts
await device.getByLabel('Password').fill('secret');
await device.keyboard.dismiss();
await device.keyboard.hide(); // يُعد مرادفاً لدالة dismiss()
await device.keyboard.show(device.getByLabel('Password'));
await device.getByRole('button', { name: 'Sign in' }).tap();
```

في نظام iOS، تستخدم عملية الإدخال `fill` أمر `typeText` التابع لـ XCTest متى كانت القيم قصيرة وآمنة، بينما يتم التوجه نحو مسار "اللصق" للعمليات الأطول. تستطيع فرض مسار اللصق يدوياً عبر الخيارات:

```ts
await device.getByLabel('Name').fill('Amr');
await device.getByLabel('Bio').fill('Long local-only text', { textInputMode: 'paste' });
```

## التنقل بين السياقات الأصلية (Native) والـ WebView

تتيح الشاشات الأصلية التحكم الكامل عبر محددات Astur المدعومة بشجرة النظام الهيكلية:

```ts
await device.getByLabel('Login').tap();
await expect(device.getByText('Credentials')).toBeVisible();
```

أما شاشات الـ WebView فتُدار بتفاعل مباشر مع شجرة الـ DOM. ويُوصى بشدة بالاعتماد على الأمر `device.webContext()`؛ فهو يوفر واجهة محايدة وقوية تعمل داخل حيز الصفحة بفضل ناقل تنقيح WebView. هذه الآلية تمنحك مناعة ضد قيود `requestAnimationFrame` التي تفرضها الواجهات المخفية في الـ WebView. وتُطبق نفس هذه التقنية بسلاسة تامة مع تطبيقات Flutter و React Native:

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

بديلاً عن ذلك، يمكنك جلب مقبض للصفحة `web.page` للتمتع بكامل إمكانات Playwright عبر أداة `webview` (محدودة حالياً بنظام Android لكونها تعتمد على Chromium CDP مع ضرورة تفعيل تصحيح WebView في التطبيق):

```ts
const web = await webview({ timeout: 30_000 });
await expect(web.page.locator('body')).toContainText(/Astur Web Lab/);
// الملاحظة: نظراً لاحتمال تأثر سرعة الـ rAF في عروض WebView المخفية، يُنصح بتمرير
// { force: true } للإجراءات الحساسة لتجاوز فحوصات "الاستقرار" في Playwright،
// أو يُفضل الاعتماد على device.webContext() لضمان سلاسة التنفيذ.
await web.page.getByRole('button', { name: /Submit web form/i }).click({ force: true });
```

يمكن استدعاء `device.contexts()` لسرد كافة السياقات الأصلية والمشتقة من WebView في أي وقت. يوفر `device.webContext()` دعماً حقيقياً للتنقل المستقل بين محركات البحث (DOM) **على نظامي Android و iOS، لكل من المحاكيات والأجهزة الحقيقية**. وفي المقابل، تبقى أداة `webview()` مقتصرة فقط على بيئة Android؛ ومحاولة استخدامها في نظام iOS ستسفر عن ظهور خطأ `WEBVIEW_NOT_SUPPORTED`. في تلك الحالات، استخدم `device.webContext()` أو المحددات الأصلية عوضاً عن ذلك. ولا غنى عن الوضع الأصلي في كلي المنصتين للتحكم بأشرطة التنقل، التنبيهات، الصلاحيات وواجهات النظام.

## إدارة التطبيق والجهاز

يوفر Astur واجهات برمجة واضحة لإدارة دورة حياة التطبيق، الصلاحيات، اتجاه الشاشة وحالة الجهاز.

| الأداة البرمجية | Android | محاكي iOS | ملاحظات |
| --- | --- | --- | --- |
| `await device.app.install()` | مدعوم | مدعوم | يثبّت التطبيق بناءً على مسار `use.astur.app.path`. بصيغة APK لـ Android و `.app` أو `.ipa` متوافق للمحاكي في iOS. |
| `await device.app.launch()` | مدعوم | مدعوم | يشغّل التطبيق اعتماداً على المعرف المخصص له. |
| `await device.app.terminate()` | مدعوم | مدعوم | يوقف سير عمل التطبيق المحدد من دون الحاجة لإزالته. |
| `await device.app.reset({ reinstall: true, launch: true })` | مدعوم | مدعوم | يعيد التثبيت ويشغل التطبيق من جديد إن لزم. مفيد جداً للحصول على بيئة عمل خالية من بقايا البيانات على محاكي iOS. |
| `await device.app.clearData()` | مدعوم | لا | يمسح البيانات الخاصة بتطبيق Android؛ بيئة iOS تستعيض عن هذا الإجراء بخيار تصفير التثبيت. |
| `await device.app.clearCache()` | مدعوم | لا | ينظف الذاكرة المخبأة لتطبيق Android؛ غياب بديل مباشر من Apple. |
| `await device.app.uninstall()` | مدعوم | مدعوم | يزيل التطبيق بشكل كامل من الجهاز/المحاكي. |
| `await device.permissions.grant('camera')` | مدعوم | مدعوم | يعتمد في Android على مدير حزم الأذونات، في حين يستخدم محاكي iOS أداة `simctl privacy`. |
| `await device.permissions.revoke('camera')` | مدعوم | مدعوم | ينطبق نفس المبدأ الخاص بطلب منح الصلاحية على سحبها. |
| `await device.setOrientation('landscape')` | مدعوم | مدعوم | يُوجه الشاشة وفق نمط العرض الأفقي بالاعتماد على مشغل المنصة. |
| `await device.orientation.portrait()` | مدعوم | مدعوم | أداة مساعدة سهلة الاستخدام للتبديل الفوري لنمط العرض العمودي. |
| `await device.lock()` | مدعوم | مدعوم | يقوم بإغلاق شاشة الجهاز أو المحاكي. |
| `await device.unlock()` | مدعوم | مدعوم | يقوم بإيقاظ وفتح قفل شاشة الهدف متى دعت الحاجة. |
| `await device.isLocked()` | مدعوم | مدعوم | يعكس ويسترجع الوضع الحالي لقفل الشاشة إذا كانت المنصة تدعم الكشف عن ذلك. |

تستند جميع أوامر إدارة التطبيقات إلى المتغير `use.astur.app` كوضع افتراضي. متى احتجت لإدارة تطبيق رديف أو مختلف ضمن الاختبار، يمكنك إمرار معرف الحزمة بشكل مباشر:

```ts
await device.app.clearData('com.example.other');
await device.app.uninstall('com.example.other');
await device.permissions.grant('photos', 'com.example.other');
```

يتم تنفيذ أوامر إدارة التطبيق والبيانات في Android عبر مدير حزم ADB. من جهة أخرى، يتيح محاكي iOS إجراءات كالتثبيت، وتحديث البيانات، والتشغيل، والإيقاف المؤقت وإعادة التهيئة، علاوةً على طلب الأذونات أو حجبها من خلال `simctl privacy`. وتجدر الإشارة إلى افتقار `simctl` لإمكانية التدخل المباشر بمسح ذاكرة الكاش الخاصة بالتطبيق.

## مساعدات بيئة التشغيل القابلة لإعادة الاستخدام

يأتي Astur مزوداً بمجموعة من المساعدات الصغيرة التي تسهل العمليات الحسابية المرتبطة بواجهات واختبارات كائنات الصفحة (Page Objects)، مما يغنيك عن كتابة وحفظ شفرات برمجية مكررة لاجتياز وتحليل بيانات الشاشة في تطبيقك.

| المساعد البرمجي | الاستخدام |
| --- | --- |
| `centerOf(bounds)` | يعود لك بإحداثيات مركز العنصر ضمن إطار الأبعاد المعطاة. |
| `pointInBounds(bounds, xRatio, yRatio)` | يستنتج الإحداثيات بناءً على نسبة وتناسب (مثلاً: `pointInBounds(screen.bounds, 0.5, 0.82)`). |
| `flattenTree(snapshot)` | يفرد الشجرة المعمارية المعقدة إلى قائمة مبسطة لتسهيل البحث عن العناصر المطلوبة. |
| `findElement(snapshot, selector)` | يطبق آلية محددات Astur على الهيكلية المبسطة للقطة؛ مفيد جداً في أعمال التشخيص والاستكشاف داخل واجهات كائنات الصفحة. |

نصيحة: اجعل منطق التطبيق الخاص (مثل "قراءة قيمة عداد مختبر النقر") محصوراً في طبقة كائن الصفحة (Page Object)، بينما دع العمليات الهندسية، واجتياز الشجرة، ومطابقة المحددات الأساسية للمساعدات الأصلية لـ Astur لضمان كفاءة الاختبار ونظافته.

## لقطات الشاشة والملفات الداخلية للجهاز

يتيح Astur التقاط صورة فورية لشاشة الجهاز كنسخة `Buffer` أو حفظها مباشرة إلى مسار محدد:

```ts
const image = await device.screenshot();
await device.screenshot({ path: 'test-results/screens/home.png' });
```

لإدارة ملفات الجهاز ضمن عمليات الاختبار والتشخيص، يُوفر `device.files` إمكانيات فعالة. على نظام Android، تعتمد هذه الميزة على نقل الملفات باستخدام تقنية ADB:

```ts
await device.files.push('./fixtures/avatar.png', '/sdcard/Download/avatar.png');

const logs = await device.files.pull('/sdcard/Download/app.log');
await device.files.save('/sdcard/Download/app.log', 'test-results/device/app.log');

const downloads = await device.files.list('/sdcard/Download');
await device.files.remove('/sdcard/Download/avatar.png');
```

هذه الخواص مثالية لاختبار ومحاكاة عمليات تحميل ورفع الملفات، وجمع الملفات المنشأة تلقائياً من قِبل التطبيق، وحفظ تقارير السجلات بعد انتهاء عملية الاختبار. يرجى الملاحظة أن قدرات نقل وإدارة الملفات غير متاحة على بيئة iOS حالياً؛ نظراً لاحتياجها لمعالجة ذكية تُدرك طبيعة الحاوية الخاصة بكل تطبيق على حدة.

## مشاريع متعددة المنصات

استفد من خصائص مشاريع Playwright لبناء بيئة اختبار شاملة:

### التنفيذ المتوازي بين Android و iOS

<div class="astur-video-card">
  <div class="astur-video-copy">
    <span class="astur-video-kicker">التنفيذ المتوازي</span>
    <strong>‏Android و iOS في اختبار Playwright موحّد.</strong>
    <p>تابع كيف يدير Astur العمليات بالتزامن بين المنصتين مستخدماً أجهزة معزولة في تسلسل اختباري مشترك.</p>
    <a class="astur-video-link" href="https://youtu.be/H1-cRGLqu2U" target="_blank" rel="noreferrer">شاهد العرض العملي على YouTube <span aria-hidden="true">↗</span></a>
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

من أجل إجراء اختبارات متوازية بفعالية، خصص مُعرّفات دقيقة للأجهزة المستهدفة ضمن كل مشروع:

- عند المزج بين محاكيي Android: استعمل قيم `device.id` مغايرة مثل `emulator-5554` و `emulator-5556`.
- عند المزج بين محاكي Android وجهاز حقيقي: استخدم المعرّفات المحددة كـ `{ id: 'emulator-5554' }` و `{ id: 'R5CT123456A' }`.
- عند إجراء اختبار يجمع بين بيئتي Android و iOS: خصّص مشروعين منفصلين باستهدافات افتراضية أو فعلية متباينة بالكامل.
- عند محاكاة iOS بوجود iPhone حقيقي: استعمل `device.id` معزول تماماً، وتيقّن من توقيع كل من التطبيق ومشغل XCUITest بشكل سليم.

يوضح الملف المرجعي `examples/config/android/playwright.parallel.config.ts` آلية تشغيل مشروعين معاً (نظام Android ومحاكي iOS). ويعتمد المتغيرات `ASTUR_ANDROID_DEVICE_ID`، `ASTUR_IOS_DEVICE_ID`، `ASTUR_IOS_DEVICE_NAME`، و `ASTUR_IOS_BUNDLE_ID` كتجاوزات بيئية اختيارية لإدارة البيئة.

يحرص Astur على ربط جهاز محدد وحجزه خصيصاً لكل جلسة عامل (Worker) قيد التنفيذ. وإن حاول عامل آخر استغلال ذات الجهاز المستهدف، فسينتهي طلبه بخطأ "رفض الحجز" للحيلولة دون أي تداخل في إدارة التطبيقات أو خلط غير مرئي للنتائج. اضبط قيمة `workers` العليا في Playwright لتتلاءم مع عدد الأجهزة المجهزة والمتاحة لديك، وتأكد من تميز مُعرّفات مشاريعك؛ بحيث يحتوي كل مشروع يعتمد على جهاز محدد على تخصيص `workers: 1`.

يجب التنويه إلى أنه لا يمكن لجهاز فعلي أو محاكي واحد احتواء وتشغيل أكثر من جلسة اختبار أصلية بتزامن في ذات الوقت. مبدأ التوازي (Parallelism) يستلزم تعدد الأجهزة بحد ذاتها: جهازان يُشغّلان عاملين، وثلاثة يغطون ثلاثة عمال، وهكذا دواليك. هذه القاعدة تسري بحذافيرها سواء كنت تعتمد محاكيات Android، أجهزته الحقيقية، محاكيات iOS، أو الأجهزة الحقيقية من Apple.

متى ما أردت تنفيذ تشغيل متوازٍ ومفلتر لملف محدد ومشروع واحد فقط، فاحرص على تمرير مسار الملف المعني قبل الاستعانة بالمعامل `--project`:

```bash
npm run test:parallel:spec -- specs/login.test.ts --project ios-simulator
```

نظراً لأن المعامل `--project` يتيح استقبال قيم متعددة في Playwright، فقد يُفسَّر أي معطى يليه خطأً على أنه اسم لمشروع آخر إن لم يتم الترتيب بشكل صحيح.
