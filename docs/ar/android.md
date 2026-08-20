# إعداد Android

يستخدم مشغّل Android في Astur أدوات Android العامة لدورة الحياة والمخرجات:

- ‏`adb devices -l` للاكتشاف
- ‏`adb install -r` للتثبيت
- ‏`monkey` أو `am start` للتشغيل
- ‏`uiautomator dump` للقطات الواجهة القديمة وللتشخيص
- ‏`input tap` و `input text` و `input swipe` و `input keyevent` للمسار الاحتياطي القديم فقط
- ‏`screencap` للقطات الشاشة
- ‏`aapt dump badging` لاستنتاج حزمة APK ونشاطها حين يتوفّر

ولا حاجة إلى خادم Appium.

ويعتمد Astur افتراضيًا مسار وكيل UIAutomator الأصلي المكتوب بـ Kotlin للبحث عن العناصر والانتظار والإجراءات والإيماءات. وتتضمن حزمة Android المنشورة ملفات APK الخاصة بالوكيل، فلا تحتاج تثبيتات npm العادية خطوة بناء منفصلة للوكيل. ولا تستخدم `automation.engine: 'auto'` إلا أثناء الانتقال إذا احتجت العودة إلى مسار ADB/XML القديم.

## Astur أثناء العمل على Android

<div class="astur-video-card">
  <div class="astur-video-copy">
    <span class="astur-video-kicker">عرض ANDROID</span>
    <strong>شاهد Astur وهو يقود تدفّق عمل كاملًا على Android.</strong>
    <p>شاهد الاكتشاف والتفاعل وتنفيذ الاختبارات أصليًا على Android وهي تعمل معًا مقابل تطبيق حقيقي.</p>
    <a class="astur-video-link" href="https://youtu.be/ByVb8MeA6kM" target="_blank" rel="noreferrer">شاهد على YouTube <span aria-hidden="true">↗</span></a>
  </div>
  <div class="astur-video-frame">
    <iframe src="https://www.youtube-nocookie.com/embed/ByVb8MeA6kM" title="Astur Android automation demonstration" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
  </div>
</div>

## تثبيت Android SDK

ثبّت Android Studio أو حزمة Android SDK عبر سطر الأوامر. وتأكد من توفّر أدوات المنصة:

```bash
adb version
```

فإذا لم يُعثر على `adb`، أضف أدوات المنصة إلى `PATH`.

مثال على macOS:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

## تشغيل محاكي

استخدم مدير الأجهزة في Android Studio أو سطر الأوامر:

```bash
emulator -list-avds
emulator -avd Pixel_8_API_35
```

ثم تحقّق:

```bash
adb devices -l
npx astur-mobile devices --android
```

## جهاز Android حقيقي

على الجهاز:

- فعّل خيارات المطوّر
- فعّل تنقيح USB
- وصّل الجهاز عبر USB
- وافق على نافذة التنقيح

للتحقق:

```bash
adb devices -l
```

ويجب أن تكون الحالة `device`. فإذا كانت `unauthorized`، فافتح قفل الجهاز ووافق على النافذة.

## إعدادات Android

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

### نقطة نهاية الوكيل الأصلي (اختياري)

```ts
agent: {
  mode: 'auto',
  endpoint: 'tcp:127.0.0.1:8787',
  launchTimeout: 15_000,
  commandTimeout: 10_000
}
```

التجاوز عبر البيئة:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
```

استخدم `agent.mode: 'required'` في CI بعد أن تستقر مجموعة أوامر الوكيل الأصلي على Android لمجموعة اختباراتك.

وافتراضيًا يبدأ Astur جلسة وكيل أصلي واحدة لكل عامل Playwright. وهو لا يعيد تثبيت الوكيل قبل كل ملف اختبار؛ إذ تُثبَّت ملفات APK المرفقة للوكيل فقط عند غياب تطبيق الوكيل أو حزمة الاختبار. واضبط `ASTUR_ANDROID_AGENT_FORCE_INSTALL=1` حين تطوّر الوكيل وتحتاج عمدًا إلى تحديث ملفات APK على الجهاز.

ومع `device.avd` يشغّل Astur المحاكي إن لم يجد محاكيًا متصلًا مطابقًا. ومع `app.path` يثبّت Astur حزمة APK قبل بدء الاختبار. وحين يتوفّر `aapt` من Android SDK يستنتج Astur أيضًا `packageName` ونشاط التشغيل `activity`.

ويمكنك مع ذلك جعل كل شيء صريحًا:

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

استخدم `device.id` محدّدًا للتشغيلات المتوازية. أما المحدِّدات الفضفاضة مثل `{ kind: 'emulator' }` فمريحة محليًا لكنها ليست آمنة بعد لتخصيص الأجهزة بالتوازي.

## خيارات جهاز Android

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

الحقول:

- ‏`avd`: اسم الجهاز الافتراضي من `emulator -list-avds`
- ‏`autoBoot`: يشغّل الـ AVD إن لم يوجد محاكي متصل مطابق؛ وقيمته الافتراضية true عند ضبط `avd`
- ‏`headless`: يضيف `-no-window`؛ وقيمته الافتراضية true
- ‏`wipeData`: يضيف `-wipe-data`؛ مفيد لتشغيلات CI النظيفة، ومدمّر لحالة المحاكي
- ‏`bootTimeout`: أقصى مدة انتظار لـ `sys.boot_completed`
- ‏`emulatorArgs`: معاملات إضافية للمحاكي

## استنتاج بيانات APK

إذا وفّرت الإعدادات هذا فقط:

```ts
app: {
  path: './apps/demo.apk'
}
```

فيحاول Astur:

```bash
aapt dump badging ./apps/demo.apk
```

ويملأ:

- `app.packageName`
- `app.activity`

وإذا لم يتوفّر `aapt`، فاضبط `ASTUR_AAPT` أو مرّر بيانات الحزمة يدويًا.

ويدعم Astur ثلاثة أوضاع لتطبيق Android:

```ts
// تثبيت حزمة APK محلية.
app: { path: './apps/demo.apk' }

// تنزيل الحزمة أثناء التشغيل ثم تثبيتها.
app: { url: 'https://example.com/apps/demo.apk' }

// تشغيل تطبيق مثبّت أصلًا على الجهاز.
app: { packageName: 'com.example', activity: '.MainActivity' }
```

وتحدّد `use.astur.timeout` المهلة الافتراضية لإجراءات العناصر وتأكيدات الجوال. وتبقى التجاوزات لكل إجراء متاحة عند الحاجة.

## إجراءات Android المدعومة

| المجال | الواجهة | ملاحظات |
| --- | --- | --- |
| دورة حياة التطبيق | `device.app.install()`, `launch()`, `terminate()`, `reset()`, `uninstall()` | تستخدم حزمة APK أو اسم الحزمة المضبوط افتراضيًا. |
| تخزين التطبيق | `device.app.clearData()`, `device.app.clearCache()` | تستخدم أوامر مدير الحِزم في Android. |
| الأذونات | `device.permissions.grant('camera')`, `revoke('camera')` | تقبل أسماء أذونات Android أو الاختصارات في Astur حيثما توفّرت. |
| الاتجاه | `device.setOrientation('landscape')`, `device.orientation.portrait()` | تستخدم التحكم في العرض والاتجاه في Android. |
| حالة القفل | `device.lock()`, `device.unlock()`, `device.isLocked()` | تستخدم واجهات الصدفة وحالة الجهاز في Android. |
| المحدِّدات الأصلية | `getByText()`, `getByLabel()`, `getByTestId()`, `getByRole()` | تمرّ عبر مسار وكيل UIAutomator الأصلي افتراضيًا. كما تُحلّ استعلامات المطابقات المتعددة (`locator.count()`, `queryAll()`, `device.findAll()`, `device.findMany()`) على الجهاز عبر `element.findAll` / `element.findMany`؛ وبنى الوكيل التي تفتقر هذه الأوامر تعود تلقائيًا إلى مسار لقطة الشجرة. |
| الإحداثيات | `device.tap()`, `device.longPress()`, `device.swipe()`, `device.drag()` | مفيدة لأسطح الإيماءات ولخطوات الاحتياط المولَّدة من الـ inspector. |
| التمرير إلى العنصر | `locator.scrollIntoView({ direction, maxScrolls })` | تعمل عبر المنصات. تمرّر عرض التمرير المحيط حتى يظهر العنصر، ثم تُحلّ بلقطته. وتغني عن مساعِدات «مرّر في حلقة حتى يظهر» المكتوبة يدويًا في كائنات الصفحات. |

أمثلة على العناصر والإيماءات:

```ts
await device.getByText('Continue').tap();
await device.getByLabel('Email').fill('qa@example.com');
await device.getByRole('button', { name: 'Submit' }).longPress({ durationMs: 800 });

// مرّر نموذجًا طويلًا حتى يظهر الهدف على الشاشة، ثم نفّذ عليه.
await device.getByText('Submit').scrollIntoView();
await device.getByLabel('Biometric login').scrollIntoView({ direction: 'up', maxScrolls: 6 });

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

### الكتابة في عنصر لا تستطيع الشجرة وصفه

ترسل `device.keyboard.type()` الأحرف إلى العرض الذي يملك التركيز، دون عنصر تستهدفه. استخدمها للعناصر التي لا تكشف حقلًا قابلًا للتعبئة — مثل حقل OTP متعدد الصناديق، حيث الصناديق عروض عادية والحقل الحقيقي مخفي:

```ts
await device.getByTestId('otp-input').tap();
await device.keyboard.type('123456');
```

ويعمل النداء نفسه على iOS، فملف اختبار واحد يغطّي الاثنين. وفضّل `fill()` كلما كان الحقل قابلًا للاستهداف: فهي تحلّ العنصر وتمسحه وتتحقق من وصول القيمة، ولا شيء من ذلك ممكن عند استهداف التركيز.

وتتبع `pressKey()` القاعدة نفسها مع الحرف المطبوع الواحد — فهي تكتب ذلك الحرف بدل إرسال keycode، فتصبح حلقة OTP رقمًا رقمًا قابلة للنقل:

```ts
for (const digit of '123456') {
  await device.pressKey(digit);
}
```

أما ما زاد على حرف واحد فيبقى مفتاحًا: المفاتيح المسمّاة (`'BACK'`, `'ENTER'`, `'VOLUME_UP'`) وأرقام keycode الخام في Android (`'66'`) تتصرف كما كانت تمامًا.

وحين يكون وضع نقطة نهاية الوكيل الأصلي مفعّلًا وسليمًا، يمكن لأوامر العناصر والإيماءات أن تمرّ عبر ناقل وكيل Kotlin على الجهاز. وإذا تعذّر وضع نقطة النهاية في `auto`، يعود Astur إلى سلوك ADB/UIAutomator الحالي.

كما تكشف `device.gestures` الأوامر `tap` و `longPress` و `pressAndHold` و `swipe` و `drag` كواجهة مجمّعة. وتكشف `device.navigation` الأوامر `back` و `home` و `recentApps`.

### التمرير إلى العناصر خارج الشاشة

الدالة `locator.scrollIntoView()` هي الطريقة المدمجة لإحضار عنصر أسفل الشاشة أو أعلاها إلى داخلها قبل التنفيذ عليه. وهي تعمل عبر المنصات (‏Android و iOS) وموجودة على كل محدِّد، فلم تعد تحتاج كتابة مساعِدات «مرّر في حلقة حتى يظهر» يدويًا في كائنات الصفحات. وإذا كان العنصر ظاهرًا أصلًا عادت فورًا دون تمرير.

```ts
// الافتراضي: التمرير للأسفل داخل الشاشة، بحدّ أقصى 10 تمريرات.
await device.getByText('Save changes').scrollIntoView();

// إظهار شيء أعلى الموضع الحالي.
await device.getByLabel('Biometric login').scrollIntoView({ direction: 'up' });

// التمرير داخل حاوية قابلة للتمرير بعينها بدل الشاشة كاملةً.
await device.getById('product-42').scrollIntoView({
  container: device.getById('catalog-list'),
  maxScrolls: 15
});
```

| الخيار | الافتراضي | الغرض |
| --- | --- | --- |
| `direction` | `'down'` | اتجاه تمرير المحتوى نحو الهدف: `'down'` أو `'up'` أو `'left'` أو `'right'`. |
| `maxScrolls` | `10` | أقصى عدد لإيماءات التمرير قبل الاستسلام. |
| `durationMs` | `400` | مدة كل إيماءة تمرير. |
| `container` | الشاشة | العنصر القابل للتمرير الذي يجري التمرير داخله. والافتراضي شاشة الجهاز، ويحلّها Astur حسب المنصة (شاشة iOS مقابل أبعاد الشجرة في Android). |
| `timeout` / `interval` | افتراضيات الجلسة | تُمرَّر إلى انتظار الظهور النهائي. |

وإذا لم يظهر العنصر أبدًا، تُطلق `scrollIntoView()` خطأ مهلة يذكر المحدِّد واتجاه التمرير الذي جرّبه.

وتقابل إدارة التطبيق أوامر مدير الحِزم في ADB:

- ‏`device.app.install(path?)` ← `adb install -r`
- ‏`device.app.uninstall(packageName?)` ← `adb uninstall`
- ‏`device.app.clearData(packageName?)` ← `pm clear`
- ‏`device.app.clearCache(packageName?)` ← `pm clear --cache-only`
- ‏`device.app.reset({ reinstall, launch })` ← إيقاف قسري مع إما `pm clear` أو إلغاء التثبيت وإعادته
- ‏`device.permissions.grant(permission, packageName?)` ← `pm grant`
- ‏`device.permissions.revoke(permission, packageName?)` ← `pm revoke`

وتُطبَّع أسماء الأذونات المختصرة مثل `camera` إلى ثوابت أذونات Android مثل `android.permission.CAMERA`؛ فمرّر نص الإذن الكامل حين تحتاج تحكمًا دقيقًا.

وتقابل مساعِدات حالة الجهاز أوامر شاشة القفل والطاقة في Android:

- ‏`device.lock()` / `device.system.lock()` ← `KEYCODE_SLEEP`
- ‏`device.unlock()` / `device.system.unlock()` ← `KEYCODE_WAKEUP` مع `wm dismiss-keyguard`
- ‏`device.isLocked()` / `device.system.isLocked()` ← حالة `dumpsys window` بعد تحليلها

وتقبل مفاتيح نظام Android أسماء ودّية مثل `BACK` و `HOME` و `ENTER` و `MENU` و `APP_SWITCH` و `RECENTS` و `VOLUME_UP` و `VOLUME_DOWN`. كما تبقى رموز مفاتيح Android الخام مثل `KEYCODE_BACK` أو القيم الرقمية عاملةً.

ومجموعة أمثلة Android مقسّمة حسب الوظيفة تحت `examples/specs`: ‏`login.test.ts` و `forms.test.ts` و `forms-slider.test.ts` و `media-upload.test.ts` و `tap-laboratory.test.ts` و `swipe.test.ts` و `drag-and-drop.test.ts` و `webview.test.ts`. وهي تتشارك تجهيزة التطبيق في `fixtures.ts` وملف كائن الصفحة الوحيد في `pages/astur-demo-app.page.ts`.

## تحويل المحدِّدات

| محدِّد Astur | مصدره في Android |
| --- | --- |
| `getByLabel()` / `by.label()` | `content-desc` أو معرّف المورد |
| `getByTestId()` / `getById()` / `by.id()` | `resource-id` |
| `getByText()` / `by.text()` | `text` أو `content-desc` |
| `getByRole()` / `by.role()` | صنف الودجة في Android بعد التطبيع مع الاسم المتاح لإمكانية الوصول |
| `getByType()` / `by.type()` | صنف Android |

فضّل تسميات إمكانية الوصول ومعرّفات الموارد الثابتة.

## مخرج الطوارئ للمحدِّد الأصلي (`by.native`)

للعنصر النادر الذي تعجز كل الاستراتيجيات أعلاه عن تثبيته — وغالبًا ما تكون
شاشة بلا بيانات إمكانية وصول، حيث المطابقة الموثوقة الوحيدة تكون بالبنية أو
بجمع عدة شروط معًا — تبني `by.native()` استعلام Android مباشرةً من حقول
`By`/`BySelector` الخاصة بـ androidx.test.uiautomator، وهي الواجهة نفسها التي
يستخدمها وكيل UiAutomator المرفق لكل استراتيجية أخرى:

```ts
await device.find(by.native({
  android: {
    className: 'android.widget.Button',
    textContains: 'Save',
    // «زر Save داخل هذه البطاقة تحديدًا» بدل «زر Save الثالث
    // على الشاشة كلها»:
    hasChild: { resourceId: 'com.example:id/card_title' }
  }
})).tap();

// التمييز بين الأشقّاء المتطابقين بالموضع (يبدأ من 0، بعد تطبيق
// كل قيود hasChild/hasDescendant):
await device.find(by.native({
  android: { className: 'android.widget.TextView', text: 'Delete' },
  instance: 2
})).tap();
```

| حقل `AndroidNativeSelector` | يقابل |
| --- | --- |
| `className` / `classNameMatches` | `BySelector.clazz(String \| Pattern)` |
| `text` / `textContains` / `textMatches` | `BySelector.text()` / `.textContains()` / `.textMatches()` |
| `description` / `descriptionContains` / `descriptionMatches` | `BySelector.desc()` / `.descContains()` / `.descMatches()` |
| `resourceId` / `resourceIdMatches` | `BySelector.res(String \| Pattern)` |
| `packageName` | `BySelector.pkg()` |
| `hasChild` / `hasDescendant` | `BySelector.hasChild()` / `.hasDescendant()`، مع تضمين `AndroidNativeSelector` آخر |

وكل حقل موجود يزيد تقييد الاستعلام نفسه (‏AND منطقي). وهذه عمدًا **ليست**
لغة تعبير حرة — فلا `eval`، ولا محلّل خاص، ولا ترجمة bytecode أثناء التشغيل
(بخلاف استراتيجية `-android uiautomator` في Appium التي تحتاج واحدة لتشغيل
شيفرة Java/Kotlin حرفية). فكل شيء يقابل واحدًا بواحد دالةً حقيقية ومفحوصة
الأنواع في `BySelector`.

وتتطلب `by.native()` وكيلًا أصليًا متصلًا — إذ لا يمكن حلّها مقابل لقطة
مخزّنة لشجرة الواجهة، ولذلك تُطلق الجلسة القديمة أو التي بلا وكيل الخطأ
`NATIVE_SELECTOR_REQUIRES_AGENT` بدل أن تطابق لا شيء بصمت. ولاستهداف iOS
بالمحدِّد نفسه، أضف نص predicate في `ios` بجوار `android` — راجع
[‏iOS: مخرج الطوارئ للمحدِّد الأصلي](../ios/).
