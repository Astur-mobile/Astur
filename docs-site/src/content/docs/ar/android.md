---
title: "Android"
description: "إعداد أجهزة Android والمحاكيات والتطبيقات والأذونات والأتمتة عبر الوكيل الأصلي."
sidebar:
  order: 4
---
يعتمد مشغّل Android في Astur على أدوات Android الرسمية والشائعة لإدارة دورة حياة التطبيقات واستخراج البيانات:

- استخدام `adb devices -l` لاكتشاف الأجهزة المتاحة.
- استخدام `adb install -r` لتثبيت التطبيقات.
- استخدام `monkey` أو `am start` لتشغيل التطبيقات.
- استخدام `uiautomator dump` لاستخراج بنية الواجهة القديمة ولأغراض التشخيص.
- استخدام أوامر مثل `input tap`، `input text`، `input swipe`، و `input keyevent` حصرياً ضمن المسار الاحتياطي القديم.
- استخدام `screencap` لالتقاط صور الشاشة.
- استخدام `aapt dump badging` لاستنباط بيانات حزمة الـ APK واسم نشاطها الرئيسي (Activity) عند توفره.

كل هذا يتم بسلاسة **دون الحاجة لأي خادم Appium**.

يعتمد Astur بصفة أساسية على وكيل UIAutomator المبرمج بـ Kotlin للبحث عن العناصر، الانتظار، تنفيذ الإجراءات، ومحاكاة الإيماءات. ولتسهيل الاستخدام، تتضمن حزمة Android المنشورة ملفات الـ APK الخاصة بهذا الوكيل، مما يُعفي مستخدمي npm من خطوة بناء الوكيل كعملية منفصلة. ولا ننصح باستخدام `automation.engine: 'auto'` إلا أثناء فترات الانتقال إذا دعت الحاجة للعودة المؤقتة لمسار ADB/XML الأقدم.

## Astur قيد العمل على نظام Android

<div class="astur-video-card">
  <div class="astur-video-copy">
    <span class="astur-video-kicker">عرض ANDROID</span>
    <strong>تابع كيف يقود Astur دورة اختبار متكاملة على Android.</strong>
    <p>استكشف كيف تتناغم عمليات الاكتشاف، التفاعل السريع، وتنفيذ الاختبارات بشكل أصيل ضد تطبيق فعلي.</p>
    <a class="astur-video-link" href="https://youtu.be/ByVb8MeA6kM" target="_blank" rel="noreferrer">شاهد العرض على YouTube <span aria-hidden="true">↗</span></a>
  </div>
  <div class="astur-video-frame">
    <iframe src="https://www.youtube-nocookie.com/embed/ByVb8MeA6kM" title="Astur Android automation demonstration" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
  </div>
</div>

## إعداد حزمة Android SDK

للبدء، قم بتثبيت Android Studio أو حزمة Android SDK عبر سطر الأوامر، وتأكد من عمل أدوات المنصة الأساسية:

```bash
adb version
```

إذا لم يتم التعرف على أمر `adb`، ستحتاج لإضافته إلى متغير النظام `PATH`.

مثال للإعداد على نظام macOS:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

## تشغيل محاكي (Emulator)

يمكنك تشغيل المحاكي إما من مدير الأجهزة في Android Studio أو مباشرة عبر سطر الأوامر:

```bash
emulator -list-avds
emulator -avd Pixel_8_API_35
```

ثم تأكد من ظهوره كجهاز متصل:

```bash
adb devices -l
npx astur-mobile devices --android
```

## إعداد جهاز Android حقيقي

إذا كنت تختبر على هاتف حقيقي، قم بالخطوات التالية على الهاتف نفسه:

- فعّل "خيارات المطور" (Developer Options).
- فعّل "تصحيح أخطاء USB" (USB Debugging).
- صِل الجهاز بحاسوبك عبر كابل USB.
- وافق على رسالة التفويض التي تظهر على شاشة الهاتف.

وللتحقق من الاتصال:

```bash
adb devices -l
```

يجب أن تظهر حالة الجهاز كـ `device`. في حال ظهرت كـ `unauthorized`، افتح قفل الهاتف واقبل رسالة التصريح.

## إعدادات Android الأساسية

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  use: {
    astur: {
      platform: 'android',
      device: {
        kind: 'emulator',
        avd: 'Pixel_9_API_35',
        autoBoot: true,
        headless: true,
        bootTimeout: 120_000
      },
      app: {
        path: './apps/demo.apk'
      }
    }
  }
});
```

### تحديد نقطة اتصال للوكيل الأصلي (اختياري)

```ts
agent: {
  mode: 'auto',
  endpoint: 'tcp:127.0.0.1:8787',
  launchTimeout: 15_000,
  commandTimeout: 10_000
}
```

طريقة التجاوز عبر متغيرات البيئة:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
```

بمجرد أن تثبت استقرار مجموعة أوامر الوكيل الأصلي مع اختباراتك، يُفضل استخدام الإعداد `agent.mode: 'required'` في بيئات التكامل المستمر (CI).

كإجراء قياسي، يخصص Astur جلسة وكيل واحدة لكل عامل (Worker) من عمال Playwright ولا يعيد تثبيت الوكيل قبل كل ملف اختبار. يتم تثبيت الوكيل المرفق فقط في حالة غيابه، أو عند غياب تطبيق الاختبار. وإذا كنت تعمل على تطوير الوكيل نفسه وتحتاج لدفع التحديثات للجهاز دورياً، قم بتعيين `ASTUR_ANDROID_AGENT_FORCE_INSTALL=1`.

بفضل توفر `device.avd`، يتولى Astur إقلاع المحاكي تلقائياً إن لم يجد واحداً متصلاً يحمل نفس المواصفات. ومع توفير `app.path`، يقوم بتنصيب حزمة الـAPK قبل إطلاق الاختبار. وحال توفر أداة `aapt`، يستخرج Astur أيضاً اسم الحزمة (`packageName`) ونشاط الإقلاع (`activity`).

بالطبع، يمكنك تحديد كافة هذه التفاصيل بشكل صريح:

```ts
device: {
  id: 'emulator-5554'
},
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

يُنصح باستخدام المعرف `device.id` لضمان الدقة أثناء التشغيل المتوازي؛ فرغم أن المحددات الفضفاضة مثل `{ kind: 'emulator' }` تعتبر عملية للاستخدام المحلي السريع، إلا أنها لا تضمن تخصيصاً محكماً للأجهزة في بيئات التشغيل المتوازية.

## تفضيلات جهاز Android

```ts
device: {
  kind: 'emulator',
  avd: 'Pixel_9_API_35',
  autoBoot: true,
  headless: true,
  wipeData: false,
  bootTimeout: 120_000,
  emulatorArgs: ['-no-snapshot-save']
}
```

شرح الحقول:

- `avd`: اسم جهازك الافتراضي كما يظهر في قائمة `emulator -list-avds`.
- `autoBoot`: لإقلاع الجهاز الافتراضي في حال غياب محاكي متصل مطابق؛ افتراضياً يُفعّل عند تعيين قيمة لـ `avd`.
- `headless`: يُلحق المعامل `-no-window` للتشغيل في الخلفية؛ القيمة الافتراضية `true`.
- `wipeData`: يُلحق المعامل `-wipe-data` لمسح بيانات المحاكي القديمة؛ ميزة هامة لاختبارات الـ CI النظيفة، ولكنها تزيل أي بيانات سابقة من المحاكي.
- `bootTimeout`: المهلة القصوى لانتظار إشارة `sys.boot_completed`.
- `emulatorArgs`: لتمرير معاملات إضافية مخصصة لسطر أوامر المحاكي.

## استنتاج بيانات حزمة الـ APK تلقائياً

إذا اقتصرت إعداداتك على تحديد مسار الـ APK كما يلي:

```ts
app: {
  path: './apps/demo.apk'
}
```

سيلجأ Astur إلى الأداة التالية كخلفية لاستخراج البيانات:

```bash
aapt dump badging ./apps/demo.apk
```

مما يُمكّنه من ملء الحقلين تلقائياً:

- `app.packageName`
- `app.activity`

وإذا كانت أداة `aapt` غائبة عن مسارك، يمكنك توجيهه عبر المتغير `ASTUR_AAPT` أو إدراج بيانات الحزمة بنفسك.

يدعم Astur ثلاثة أوضاع لإدارة تطبيق Android:

```ts
// الوضع الأول: تثبيت ملف APK متاح محلياً
app: { path: './apps/demo.apk' }

// الوضع الثاني: تنزيل ملف APK أثناء التشغيل ومن ثم تثبيته
app: { url: 'https://example.com/apps/demo.apk' }

// الوضع الثالث: إطلاق تطبيق موجود بالفعل على الجهاز
app: { packageName: 'com.example', activity: '.MainActivity' }
```

يتحكم الإعداد `use.astur.timeout` بالمهلة الافتراضية للتفاعل مع العناصر وتأكيد حالة الواجهة. وبالتأكيد، يمكنك تعيين مهلة خاصة لأي إجراء بعينه متى لزم الأمر.

## إجراءات Android المدعومة

| نطاق الإجراء | الأداة / الواجهة | ملاحظات إضافية |
| --- | --- | --- |
| إدارة التطبيق | `device.app.install()`, `launch()`, `terminate()`, `reset()`, `uninstall()` | تعتمد افتراضياً على ملف الـ APK أو اسم الحزمة المحددة. |
| بيانات التطبيق | `device.app.clearData()`, `device.app.clearCache()` | تُنفذ عبر أوامر مدير الحزم في نظام Android. |
| الصلاحيات والأذونات | `device.permissions.grant('camera')`, `revoke('camera')` | تقبل الأسماء الرسمية لأذونات النظام أو اختصارات Astur المبسطة. |
| توجيه الشاشة | `device.setOrientation('landscape')`, `device.orientation.portrait()` | تُنفذ باستخدام أدوات Android للتحكم بالعرض والتوجيه. |
| قفل الشاشة | `device.lock()`, `device.unlock()`, `device.isLocked()` | توظّف واجهات الشِل (Shell) المتاحة لقراءة والتحكم بحالة القفل. |
| التفاعل مع المحددات | `getByText()`, `getByLabel()`, `getByTestId()`, `getByRole()` | تُوجه افتراضياً لمسار وكيل UIAutomator. عمليات البحث المتعددة (كـ `locator.count()` وغيرها) تُعالج داخل الجهاز عبر `element.findAll` / `element.findMany`؛ وإن لم يدعمها بناء الوكيل، ترتد لآلية قراءة اللقطات. |
| التفاعل الإحداثي | `device.tap()`, `device.longPress()`, `device.swipe()`, `device.drag()` | مفيدة للتعامل مع الإيماءات الخاصة أو الإجراءات الاحتياطية المستخرجة من الـInspector. |
| التمرير للوصول للعنصر | `locator.scrollIntoView({ direction, maxScrolls })` | تعمل بشكل موحد عبر المنصات؛ تمرر الشاشة أو العنصر الحاوي حتى يظهر الهدف المراد، مما يُغنيك عن برمجة حلقات بحث (loops) يدوية. |

بعض الأمثلة على إجراءات التفاعل والإيماءات:

```ts
await device.getByText('Continue').tap();
await device.getByLabel('Email').fill('qa@example.com');
await device.getByRole('button', { name: 'Submit' }).longPress({ durationMs: 800 });

// تمرير شاشة طويلة للوصول للهدف ومن ثم التفاعل معه
await device.getByText('Submit').scrollIntoView();
await device.getByLabel('Biometric login').scrollIntoView({ direction: 'up', maxScrolls: 6 });

// التفاعل المباشر مع الشاشة بالإحداثيات
await device.tap({ x: 120, y: 780 });
await device.longPress({ x: 360, y: 900 }, { durationMs: 900 });
await device.swipe({
  start: { x: 500, y: 1200 },
  end: { x: 500, y: 300 },
  durationMs: 300
});
await device.drag({
  start: { x: 120, y: 1100 },
  end: { x: 360, y: 420 },
  durationMs: 800
});
```

وإجراءات التحكم بالنظام:

```ts
await device.setOrientation('landscape');
await device.orientation.portrait();

await device.back();
await device.home();
await device.recentApps();
await device.pressKey('ENTER');
await device.lock();
await device.unlock();
await device.system.isLocked();

await device.screenshot();
```

### الكتابة في عناصر يصعب استهدافها (عناصر بدون حاوية وصفية)

تُرسل الدالة `device.keyboard.type()` الإدخالات النصية للعنصر الذي يحظى بالتركيز (Focus) حالياً دون الحاجة لتحديد عنصر بعينه. وتبرز أهمية هذه الخاصية عند التعامل مع حقول غير تقليدية كالتي تُستخدم في إدخال أرقام الـ OTP المجزأة؛ حيث تتكون الواجهة المرئية من صناديق منفصلة بينما يختبئ حقل الإدخال الحقيقي وراءها:

```ts
await device.getByTestId('otp-input').tap();
await device.keyboard.type('123456');
```

الجدير بالذكر أن هذا الإجراء يعمل بفعالية ذاتها على نظام iOS، ما يسمح بتوحيد كود الاختبار. ومع ذلك، **استخدم `fill()` كلما توفرت لك القدرة على استهداف الحقل بصورة صريحة**، لأنها تتولى تحديد العنصر، وتفريغه، ثم التحقق من ثبات القيمة المُدخلة - وكلها إجراءات يستحيل القيام بها عند الاعتماد على حالة التركيز فقط.

وينطبق المبدأ نفسه على دالة `pressKey()` عند استخدام حرف واحد، حيث تُرسل الحرف نفسه بدلاً من إرسال رمز المفتاح (keycode)، مما يُسهل محاكاة كتابة الأرقام بشكل متتالٍ:

```ts
for (const digit of '123456') {
  await device.pressKey(digit);
}
```

أما عند تمرير سلاسل أطول من حرف واحد، فإنها تُفسر كأوامر مفاتيح نظام (مثل `'BACK'`, `'ENTER'`, `'VOLUME_UP'`) أو رموز خام كـ (`'66'`) وتتصرف تماماً كما هو متوقع.

عندما يكون الوكيل الأصلي متصلاً وفعالاً، تمر كافة أوامر العناصر والإيماءات عبر ناقل وكيل Kotlin. وفي حال واجه وضع النقطة التلقائي (`auto`) أي مشكلة، يتراجع Astur بهدوء لاستخدام أدوات ADB/UIAutomator الأقدم لضمان استمرارية الاختبار.

يقدم الكائن `device.gestures` مجموعة شاملة من أدوات الإيماءات مثل `tap`، `longPress`، `pressAndHold`، `swipe` و `drag`. كما يتكفل `device.navigation` بمهام التنقل الأساسية كـ `back`، `home`، و `recentApps`.

### الوصول للعناصر الخفية خارج نطاق الشاشة (التمرير)

تُعد الدالة المدمجة `locator.scrollIntoView()` الحل الأمثل لسحب العناصر الموجودة خارج الإطار المرئي للشاشة (في الأسفل أو الأعلى) لتصبح ظاهرة للتفاعل. تتوافق هذه الدالة تماماً مع بيئتي (Android و iOS) ومتاحة لكل محدد، مما يُغنيك نهائياً عن برمجة حلقات معقدة لاجتياز الشاشات الطويلة. إذا كان العنصر مرئياً بالفعل، فلن تقوم الدالة بأي تمرير وستعود فوراً.

```ts
// السلوك القياسي: التمرير للأسفل داخل الشاشة بمعدل 10 محاولات كحد أقصى.
await device.getByText('Save changes').scrollIntoView();

// تمرير الشاشة للأعلى للكشف عن عنصر محدد.
await device.getByLabel('Biometric login').scrollIntoView({ direction: 'up' });

// تحديد حاوية تمرير بعينها عوضاً عن تمرير كامل الشاشة.
await device.getById('product-42').scrollIntoView({
  container: device.getById('catalog-list'),
  maxScrolls: 15
});
```

| المعامل | القيمة الافتراضية | التوضيح |
| --- | --- | --- |
| `direction` | `'down'` | مسار التمرير للكشف عن العنصر: يدعم `'down'`، `'up'`، `'left'` أو `'right'`. |
| `maxScrolls` | `10` | السقف المسموح به لعدد الإيماءات قبل الإعلان عن تعذر العثور على العنصر. |
| `durationMs` | `400` | المدة الزمنية المستغرقة لكل إيماءة (بالملي ثانية). |
| `container` | نافذة الشاشة | العنصر الحاوي المُعد للتمرير داخله. يعتمد افتراضياً على شاشة الجهاز الكاملة (يعالجها Astur كشاشة في iOS وأبعاد الشجرة في Android). |
| `timeout` / `interval` | مهلة الجلسة | تُنقل مباشرة لمعاملات انتظار الظهور النهائي بعد التمرير. |

إذا انقضت المحاولات دون العثور على العنصر، تطلق الدالة `scrollIntoView()` خطأ يوضح المحدد المنشود واتجاه التمرير الذي تم تجربته.

تتوافق أوامر إدارة التطبيقات بشكل مباشر مع أوامر مدير الحزم في ADB:

- `device.app.install(path?)` ← تعادل `adb install -r`
- `device.app.uninstall(packageName?)` ← تعادل `adb uninstall`
- `device.app.clearData(packageName?)` ← تعادل `pm clear`
- `device.app.clearCache(packageName?)` ← تعادل `pm clear --cache-only`
- `device.app.reset({ reinstall, launch })` ← تعادل فرض الإيقاف المتبوع بـ `pm clear` أو إجراء إزالة كاملة ومن ثم إعادة تنصيب
- `device.permissions.grant(permission, packageName?)` ← تعادل `pm grant`
- `device.permissions.revoke(permission, packageName?)` ← تعادل `pm revoke`

تم تصميم النظام ليعالج اختصارات الأذونات الشائعة (مثل كلمة `camera`) ويقوم بترجمتها تلقائياً إلى قيم النظام المطولة كـ `android.permission.CAMERA`. إذا استدعت الحاجة تحكماً أعمق، لا تتردد بتمرير اسم الإذن بصيغته الكاملة.

آلية مساعِدات حالة الجهاز تتواصل مباشرة مع أوامر إدارة الطاقة والشاشة في Android:

- `device.lock()` / `device.system.lock()` ← تُترجم لـ `KEYCODE_SLEEP`
- `device.unlock()` / `device.system.unlock()` ← تُترجم لـ `KEYCODE_WAKEUP` مرفقاً بـ `wm dismiss-keyguard`
- `device.isLocked()` / `device.system.isLocked()` ← تُقرأ عبر استخلاص حالة النظام من `dumpsys window`

وتتيح مفاتيح النظام في Android استخدام مسميات مألوفة وواضحة مثل `BACK`، `HOME`، `ENTER`، `MENU`، `APP_SWITCH`، `RECENTS`، `VOLUME_UP`، و `VOLUME_DOWN`. وتظل الرموز التقليدية والأساسية (كـ `KEYCODE_BACK` أو القيم الرقمية) مدعومة وفعالة دون مشكلة.

يقدم مجلد `examples/specs` مجموعة وافية من اختبارات Android مصنفة حسب المهام: كاختبارات تسجيل الدخول `login.test.ts`، النماذج `forms.test.ts` و `forms-slider.test.ts`، إدارة الملفات `media-upload.test.ts`، والتفاعل المتخصص في `tap-laboratory.test.ts`، `swipe.test.ts`، `drag-and-drop.test.ts`، وصولاً إلى `webview.test.ts`. تتشارك كل هذه الاختبارات إعدادات الـ Fixtures من `fixtures.ts` وملف كائن صفحة مركزي `pages/astur-demo-app.page.ts`.

## تحويلات ومكافئات المحددات (Selectors)

| محددات Astur | الأصل المعادل في Android |
| --- | --- |
| `getByLabel()` / `by.label()` | `content-desc` أو معرف المورد |
| `getByTestId()` / `getById()` / `by.id()` | `resource-id` |
| `getByText()` / `by.text()` | `text` أو `content-desc` |
| `getByRole()` / `by.role()` | صنف الـWidget مقترناً بتسمية خصائص الوصول |
| `getByType()` / `by.type()` | صنف (Class) الـWidget في Android |

*نصيحة: احرص دائماً على الاعتماد على تسميات إمكانية الوصول ومعرفات الموارد الثابتة لضمان أفضل استقرارية لاختباراتك.*

## الاستعلام المتقدم كخيار أخير: `by.native`

في السيناريوهات المعقدة والنادرة — عندما تعجز الطرق القياسية عن تثبيت هدفك بشكل صحيح، وخصوصاً في واجهات تفتقر لخصائص إمكانية الوصول حيث يُحتم الأمر استخدام محددات بنيوية أو شرطية مركبة — توفر أداة `by.native()` حلاً جذرياً بتمكينها لك من صياغة استعلام مباشر باستخدام معاملات `By`/`BySelector` المدعومة من `androidx.test.uiautomator`. وهي ذات الآلية التي يعتمد عليها وكيل UIAutomator الداخلي:

```ts
await device.find(by.native({
  android: {
    className: 'android.widget.Button',
    textContains: 'Save',
    // لتحديد "زر Save ضمن هذه البطاقة المعينة" بدل الاعتماد على ترتيب الزر (كالزر الثالث في الصفحة):
    hasChild: { resourceId: 'com.example:id/card_title' }
  }
})).tap();

// للتمييز بين عناصر متماثلة استناداً لترتيبها (يبدأ العد من الصفر بعد استيفاء جميع الشروط):
await device.find(by.native({
  android: { className: 'android.widget.TextView', text: 'Delete' },
  instance: 2
})).tap();
```

| حقل `AndroidNativeSelector` | الواجهة الأصلية المقابلة |
| --- | --- |
| `className` / `classNameMatches` | `BySelector.clazz(String \| Pattern)` |
| `text` / `textContains` / `textMatches` | `BySelector.text()` / `.textContains()` / `.textMatches()` |
| `description` / `descriptionContains` / `descriptionMatches` | `BySelector.desc()` / `.descContains()` / `.descMatches()` |
| `resourceId` / `resourceIdMatches` | `BySelector.res(String \| Pattern)` |
| `packageName` | `BySelector.pkg()` |
| `hasChild` / `hasDescendant` | `BySelector.hasChild()` / `.hasDescendant()` (مع إمكانية تضمين `AndroidNativeSelector` إضافي) |

كل حقل تضيفه للاستعلام يتصرف كشرط تقييدي يضيق نطاق البحث (يُعادل المعامل المنطقي `AND`). وهذه التركيبة صُممت قصداً لتكون بيئة مقيدة **وليست** لغة برمجة حرة التنفيذ؛ فلا وجود لاستدعاءات `eval`، ولا محولات، ولا آليات لترجمة كود برمجي (Bytecode) أثناء التنفيذ — وهو ما يميزها عن استراتيجية `-android uiautomator` المستخدمة في Appium والتي تستلزم تشغيل كود حرفي لـ Java أو Kotlin. كل حقل هنا يقابل دالة مباشرة وحقيقية في مكتبة `BySelector`.

نُذكّر بأن استخدام `by.native()` يقتضي أن يكون الوكيل الأصلي متصلاً وفعالاً؛ إذ لا يمكن تمرير هذا الاستعلام لمعالجة لقطة شاشة مجردة. ولهذا السبب، فإن الجلسات المعتمدة على الأساليب القديمة ستعترض الخطأ `NATIVE_SELECTOR_REQUIRES_AGENT` عوضاً عن الفشل الصامت. إذا أردت توجيه الاستعلام ذاته نحو نظام iOS، كل ما عليك هو إضافة مُعرّف الـ Predicate أسفل وسم `ios` — لمعلومات أشمل، يُرجى الرجوع لـ [iOS: مخرج الطوارئ للمحدد الأصلي](../ios/).
