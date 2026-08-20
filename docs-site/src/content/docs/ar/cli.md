---
title: "مرجع واجهة الأوامر"
description: "أوامر doctor و devices و init و codegen و inspect و test."
sidebar:
  order: 8
---
يُنشر Astur عبر حزمة `astur-mobile` لأن الاسم غير المنطاق `astur` محجوز أصلًا على npm. أما الملف التنفيذي فما زال `astur`.

من داخل هذا المستودع:

```bash
npx astur-mobile <command>
```

وبعد التثبيت المحلي، تكشف npm أيضًا:

```bash
npx astur <command>
```

## `doctor`

يفحص متطلبات الجهاز المضيف.

```bash
npx astur-mobile doctor
npx astur-mobile doctor --verbose
```

تُخفي المخرجات الافتراضية أخطاء الأوامر الطويلة. استخدم `--verbose` للحصول على مخرجات ADB أو Xcode أو المحاكي كاملةً.

## `devices`

يسرد أجهزة Android ومحاكيات iOS وأجهزة iOS الحقيقية الموصولة.

```bash
npx astur-mobile devices
npx astur-mobile devices --android
npx astur-mobile devices --ios
```

استخدم قيمة `id` المطبوعة في `use.astur.device.id` داخل `playwright.config.ts`. وعلى Android هي رقم ADB التسلسلي، مثل `emulator-5554` للمحاكي أو رقم USB التسلسلي للجهاز الحقيقي. وعلى iOS هي UDID المحاكي من `simctl` أو UDID الجهاز الفعلي من `devicectl`.

يختار `platform` مشغّل Android أو iOS. أما `device.kind` فمجرّد مرشِّح اختياري للاختيار الفضفاض، مثل «أي محاكي» أو «أي جهاز Android حقيقي». وحين تمرّر `id` محدّدًا لا تحتاج `kind` عادةً.

أمثلة:

```ts
// محاكي Android يعمل أصلًا.
device: { id: 'emulator-5554' }

// جهاز Android حقيقي من adb devices -l.
device: { id: 'R5CT123456A' }

// محاكي iOS بالـ UDID.
device: { id: '4E2F2A1D-9B8A-4D41-8E5F-123456789ABC' }

// محاكي iOS بالاسم.
device: { name: 'iPhone 16 Pro' }

// جهاز iOS حقيقي بالـ UDID.
device: { kind: 'real', id: '00008030-000548220EF0802E' }

// محدِّد فضفاض: أي محاكي Android متصل.
device: { kind: 'emulator' }
```

على Linux و Windows يطبع `--ios` رسالة عن قيد المنصة بدل أن يفشل.

## `init`

يشغّل معالج إعداد وينشئ ملفات مبدئية:

```bash
npx astur-mobile init
```

ولبيئات CI أو العروض أو الصدفات غير التفاعلية، استخدم قيم محاكي Android الافتراضية:

```bash
npx astur-mobile init --yes
```

يسأل المعالج عن:

- ‏Android أو iOS أو كليهما
- محاكي Android، أو محاكي iOS، أو جهاز حقيقي، أو إعداد BrowserStack مبدئي
- مسار تطبيق محلي، أو رابط تنزيل، أو حزمة/معرّف مثبّت أصلًا
- المهلة الافتراضية لعناصر الجوال
- تقارير HTML/JUnit
- إعدادات لقطة الشاشة الأصلية والفيديو الأصلي وتتبّع Playwright

الملفات المولّدة:

- `playwright.config.ts`
- `tests/example.test.ts`
- `.gitignore`
- `ASTUR_SETUP.md`

ولا تُستبدل الملفات الموجودة.

يُجهَّز إعداد BrowserStack بمتغيرات البيئة المتوقعة، لكن التنفيذ السحابي غير مطبَّق في الإصدار التجريبي الحالي. أما مسارات المحاكي المحلي والأجهزة الحقيقية فقابلة للتشغيل اليوم.

## `test`

يشغّل Playwright Test:

```bash
npx astur-mobile test
npx astur-mobile test tests/login.test.ts
npx astur-mobile test --project android-pixel
```

استخدم `playwright.config.ts` للتحكم في وضع الوكيل الأصلي وسلوك نقطة النهاية:

- ‏`agent.mode: 'auto'` للانتقال والبيئات المختلطة
- ‏`agent.mode: 'required'` للفرض الصارم في CI
- ‏`agent.mode: 'off'` لإجبار استخدام أدوات المنصة الاحتياطية

متغيرات بيئة نقاط نهاية المنصات:

- `ASTUR_ANDROID_AGENT_ENDPOINT`
- `ASTUR_IOS_AGENT_ENDPOINT`

## `codegen`

يهيّئ جلسة inspector وتوليد كود مدعومة ببيئة التشغيل، وتستخدم محرّك المحدِّدات نفسه الموجود في `@astur-mobile/core`.

```bash
npx astur-mobile codegen
npx astur-mobile codegen --android --device emulator-5554 --app ./MyApp.apk --app-id com.example.myapp
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
npx astur-mobile codegen --ios --real --device <device-udid> --app ./MyApp.ipa --app-id com.example.myapp
```

سلوك الإصدار التجريبي الحالي:

- يختار تلقائيًا جهازًا متصلًا أو مُقلَعًا (أو يستخدم `--device`)
- يثبّت التطبيق ويشغّله اختياريًا عند تمرير `--app` و/أو `--app-id`
- يفتح واجهة Astur Inspector الحيّة افتراضيًا
- يبثّ لقطات الشاشة وتحديثات شجرة الواجهة الدلالية من الجلسة النشطة
- يرتّب اقتراحات المحدِّدات من الشجرة المخزّنة مؤقتًا لاختيار سريع الاستجابة
- يسجّل النقرات على المرآة بتنفيذ نقرة إحداثية أصلية أولًا، ثم يُلحق أفضل محدِّد دلالي متى توفّر
- يسجّل تمرير عجلة الفأرة فوق المرآة كخطوات `device.swipe(...)`
- يتيح لك تبديل الأجهزة من شارة الجهاز الحالي في الترويسة دون إعادة تشغيل `codegen`
- يكشف إجراءات التطبيق والجهاز تحت زر `Controls`
- يتيح لك تثبيت ملف APK مرفوع، أو `.app` لمحاكي، أو `.ipa` لجهاز حقيقي، وتشغيل تطبيق مثبّت أصلًا بمعرّف الحزمة، ومنح الأذونات أو سحبها، ومسح بيانات التطبيق أو ذاكرته حيثما دعمت المنصة ذلك
- يصدّر كود اختبار بصيغة TypeScript أو JavaScript باستخدام واجهة `@astur-mobile/test`

قد تظهر مرآة الجهاز قبل امتلاء شجرة الواجهة بلحظة. وتتطلب لقطات الشاشة وفحص الشجرة والإجراءات الأصلية على الأجهزة الحقيقية وكيل iOS سليمًا مرتبطًا بمعرّف حزمة التطبيق. والأمر المجرّد `npx astur-mobile codegen --ios` يجعل معرّف الحزمة الافتراضي `com.astur.demo`؛ فمرّر `--app-id` (أو اضبط `ASTUR_IOS_BUNDLE_ID`) لتطبيقك أنت. ومرّر دائمًا ملف `.app` للمحاكي أو `.ipa` للجهاز الحقيقي مع `--app` في التشغيل الأول كي يستطيع Astur تثبيته — فإن مرّرت `--app-id` وحده ولم يكن التطبيق مثبّتًا، أعاد Astur الخطأ `IOS_APP_NOT_INSTALLED`. وللأجهزة الحقيقية اضبط `ASTUR_IOS_DEVELOPMENT_TEAM` كي يستطيع Xcode توقيع مشغّل XCUITest المرفق، وتأكد من أن سلسلة مفاتيح التوقيع في macOS غير مقفلة. وحين يتعذّر قراءة الشجرة، يعرض الـ inspector خطأ المنصة في منطقة الحالة بالترويسة بدل عرض شجرة فارغة بصمت.

الرايات:

- `--android` أو `--ios`
- `--platform android|ios`
- `--device <id>`
- `--app <path>`
- `--app-id <package-or-bundle-id>`
- `--ui` (الافتراضي)
- `--no-ui`
- `--no-launch`
- `--json`

## `inspect`

اسم بديل لـ `codegen`.
