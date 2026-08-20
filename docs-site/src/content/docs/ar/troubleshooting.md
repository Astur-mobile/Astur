---
title: "حل المشكلات"
description: "تشخيص مشكلات الأجهزة والتطبيقات والوكيل والـ Inspector وتنفيذ الاختبارات."
sidebar:
  order: 7
---
ابدأ بـ:

```bash
npx astur-mobile doctor
```

واستخدم الوضع المفصّل حين يفشل أمر:

```bash
npx astur-mobile doctor --verbose
```

## لم يُعثر على ADB

العَرَض:

```text
ADB failed
```

الحل:

- ثبّت Android SDK Platform Tools
- أضف `platform-tools` إلى `PATH`

```bash
adb version
```

## لم تُكتشف أجهزة Android

العَرَض:

```text
Android devices: No Android devices detected.
```

الحل:

- شغّل محاكيًا
- أو وصّل جهازًا حقيقيًا
- فعّل تنقيح USB
- ووافق على نافذة تنقيح USB

للتحقق:

```bash
adb devices -l
```

## جهاز Android غير مصرّح له

العَرَض:

```text
unauthorized
```

الحل:

- افتح قفل الهاتف
- اقبل نافذة تنقيح USB
- أعد توصيل USB
- نفّذ `adb kill-server && adb start-server`

## فشل استنتاج بيانات Android

العَرَض:

```text
AAPT_NOT_FOUND
```

الحل:

- تأكد من تثبيت أدوات بناء Android SDK
- اضبط `ANDROID_HOME` أو `ANDROID_SDK_ROOT`
- اضبط `ASTUR_AAPT` على المسار الكامل لـ `aapt`

أو مرّر البيانات يدويًا:

```ts
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

## تشغيل Android يتطلب اسم الحزمة

العَرَض:

```text
Android launch requires app.packageName.
```

أصلح إعداداتك بتمرير `packageName`، أو تأكد من توفّر `aapt` كي يستنتجه Astur من حزمة APK.

## لم يُعثر على Xcode

العَرَض:

```text
Xcode failed
```

الحل:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
```

## لا توجد محاكيات iOS

العَرَض:

```text
iOS simulators: No iOS simulators were found.
```

الحل:

- افتح Xcode
- ثبّت بيئة تشغيل محاكي iOS من Settings ‹ Platforms

للتحقق:

```bash
xcrun simctl list devices available
```

## إجراءات iOS الأصلية تتطلب وكيل XCUITest

العَرَض:

```text
XCTEST_AGENT_REQUIRED
```

تستطيع أوامر دورة حياة iOS ولقطات الشاشة العمل عبر `simctl`، لكن البحث عن العناصر الأصلية والإيماءات يتطلبان وكيل XCUITest بلغة Swift.

الحل:

- مرّر معرّف حزمة التطبيق عند بدء توليد الكود أو الاختبارات: `--app-id com.example.demo`
- أو اضبط `ASTUR_IOS_BUNDLE_ID=com.example.demo`
- وفي الـ Inspector استخدم `Controls` ‹ App للتشغيل بمعرّف الحزمة؛ فهذا يعيد ربط وكيل XCUITest بذلك التطبيق
- ونفّذ `npx astur-mobile doctor --verbose` إذا فشل بناء Xcode أو تسجيل الوكيل

ولتطبيق العرض المرفق، يجعل توليد الكود في Astur المعرّف الافتراضي `com.astur.demo`.

## فشل بدء وكيل XCUITest على iOS

العَرَض:

```text
IOS_XCTEST_AGENT_START_FAILED
```

يبدأ Astur مشغّل XCUITest المرفق لأتمتة المحاكي وينتظر تسجيله لدى جسر المضيف. ويعيد المشغّل محاولة البدء افتراضيًا، ويضمّن مخرجات `xcodebuild` الأخيرة في بيانات الخطأ حين يستمر فشل التسجيل.

الحل:

- تأكد من إقلاع المحاكي المختار: `xcrun simctl list devices booted`
- تأكد من تثبيت معرّف حزمة التطبيق، أو مرّر `app.path` مع `app.bundleId`
- أعد تشغيل الأمر نفسه مرة أخرى بعد بدء Xcode البارد؛ فمسار DerivedData المُعاد استخدامه يجعل البدء الثاني أسرع
- ولا ترفع `agent.launchTimeout` إلا حين يكون المضيف بطيئًا فعلًا
- واضبط `ASTUR_IOS_AGENT_START_ATTEMPTS=3` في بيئات CI غير المستقرة إذا فشلت خدمات المحاكي أحيانًا في تشغيل XCTest من المحاولة الأولى

## جهاز iOS الحقيقي يحتاج فريق توقيع

العَرَض:

```text
IOS_DEVELOPMENT_TEAM_REQUIRED
```

عثر Astur على هاتف iPhone الفعلي وحاول بدء مشغّل XCUITest المرفق، لكن Xcode لم يستطع توقيع المشغّل.

الحل:

- أضف حساب Apple Developer في Xcode
- افتح قفل هاتف iPhone الموصول وامنحه الثقة
- فعّل وضع المطوّر على الجهاز
- اضبط `ASTUR_IOS_DEVELOPMENT_TEAM=<team id>`
- وتأكد من أن ملف IPA موقّع لهذا الجهاز أيضًا

وعند التشغيل من مستودع المصدر، يكفي اختيار فريق في `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` للتشغيلات المحلية لأن Astur يستطيع استنتاج ذلك الفريق. أما تثبيتات npm المنشورة و CI فينبغي أن تضبط `ASTUR_IOS_DEVELOPMENT_TEAM` صراحةً.

وتتضمن تفاصيل الخطأ مخرجات `xcodebuild` الأخيرة، فتُظهر سجلات CI الهدف الذي فشل توقيعه بالضبط.

## توقيع تطبيق iOS غير موثوق

العَرَض:

```text
IOS_APP_SIGNATURE_NOT_TRUSTED
```

أو:

```text
IOS_APP_INSTALL_SIGNATURE_INVALID
```

أو يعرض iPhone:

```text
Astur is no longer available
```

بدأ مشغّل XCUITest في Astur، لكن iOS رفض تشغيل التطبيق قيد الاختبار. أو، عند تمرير `--app` / `app.path`، رفض iOS تثبيت ملف IPA قبل بدء المشغّل. وهذه مشكلة توقيع أو provisioning أو ثقة في التطبيق، لا مشكلة عرض في الـ Inspector.

الحل:

- ثبّت ملف IPA موقّعًا لـ UDID الجهاز الموصول
- أعد بناء ملف IPA أو أعد توقيعه إذا أشارت مخرجات التثبيت إلى انتهاء ملف provisioning
- امنح الثقة لملف تعريف المطوّر على iPhone حين يطلب iOS ذلك
- أبقِ معرّف حزمة التطبيق متوائمًا مع `--app-id` / `app.bundleId`
- مرّر `--app <path-to-device-signed.ipa>` إلى توليد الكود كي يحدّث Astur التطبيق المثبّت قبل الاتصال
- وإذا وُقّع التطبيق بفريق أو ملف تعريف مختلف، فألغِ تثبيت التطبيق القديم من الجهاز ثم أعد تشغيل توليد الكود

ولتوليد الكود، يفرض Astur تثبيت مسار تطبيق iOS المُمرَّر مرة واحدة قبل بدء مشغّل XCUITest. أما تشغيلات الاختبار العادية فتُبقي الافتراض الأسرع وتتخطّى إعادة التثبيت متى كان معرّف الحزمة مثبّتًا أصلًا.

## سلسلة مفاتيح جهاز iOS الحقيقي مقفلة

العَرَض:

```text
IOS_SIGNING_KEYCHAIN_LOCKED
```

أو تطبع الطرفية مرارًا:

```text
Password:
```

يحاول Xcode الوصول إلى شهادة توقيع Apple Development لمشغّل XCUITest المرفق، لكن macOS يطلب إذن سلسلة المفاتيح.

الحل:

- افتح قفل سلسلة مفاتيح الدخول قبل بدء Astur
- وفي تطبيق Keychain Access، اسمح لـ codesign أو Xcode بالوصول إلى شهادة Apple Development عند الطلب
- وتجنّب تشغيل الـ Inspector في طرفية تنتظر نافذة توقيع تفاعلية
- أما في CI فاستورد شهادة التوقيع إلى سلسلة مفاتيح مؤقتة غير مقفلة قبل تشغيل Astur

يبدأ Astur وكيل الجهاز الحقيقي في مجموعة عمليات معزولة كي لا تظل نوافذ التوقيع مستحوذة على طرفية الـ Inspector. وإذا تعذّر المضي في التوقيع، يبلّغ Astur بالخطأ `IOS_SIGNING_KEYCHAIN_LOCKED` مع مخرجات `xcodebuild` الأخيرة.

## جسر جهاز iOS الحقيقي لا يستطيع التسجيل

العَرَض:

```text
IOS_XCTEST_AGENT_START_FAILED
```

مع مخرجات تُظهر أن مشغّل XCUITest قد بدأ لكنه لم يسجّل لدى جسر Astur.

الحل:

- أبقِ الهاتف مفتوح القفل أثناء البدء
- اسمح بالاتصالات الواردة إذا طلب جدار حماية macOS ذلك لـ Node.js
- أبقِ الجهاز موصولًا عبر USB كي يستطيع Astur استخدام نفق Xcode/CoreDevice
- ألغِ ضبط `ASTUR_IOS_AGENT_HOST` إذا كان يجبر الهاتف على مسار شبكة محلية محجوب
- ولا تضبط `ASTUR_IOS_AGENT_HOST` على عنوان Mac إلا حين يكون ذلك العنوان قابلًا للوصول من الهاتف
- وتجنّب VPN أو عزل الشبكة بين Mac والجهاز عند استخدام جسر عبر الشبكة المحلية
- ولا ترفع `agent.launchTimeout` إلا بعد التأكد من إمكانية الوصول إلى مضيف الجسر

وإذا تضمنت مخرجات `xcodebuild` العبارة `NSURLErrorDomain Code=-1009` أو `Local network prohibited`، فقد بدأ الوكيل لكن iOS حجب مسار الشبكة. والنقل عبر USB/CoreDevice هو الحل المفضّل؛ أما فرض عنوان Wi-Fi فقد يتطلب إذن الشبكة المحلية وتعديلات في جدار الحماية.

## الـ Inspector لا يصبح جاهزًا أبدًا

العَرَض:

```text
Inspector is not ready yet   (spinner never clears; badge stays "Connecting…")
```

يُفتح تبويب المتصفح لكن مرآة الجهاز لا تظهر أبدًا وتبقى شجرة الواجهة فارغة.

تحقّق بالترتيب:

- **تبويب خاطئ أو قديم.** فكل تشغيل لـ `codegen` يطبع سطرًا جديدًا `ui  live  http://localhost:<port>` ويفتح تبويبًا جديدًا. والتبويب المتروك من تشغيل سابق يشير إلى منفذ ميت ويعرض «Connecting…» إلى الأبد. أغلق التبويبات القديمة وافتح الرابط من التشغيل **الحالي**.
- **تشغيل سابق ما زال محتجزًا للجهاز.** ينظّف Astur تلقائيًا جلسات الوكيل المتبقية للجهاز نفسه قبل بدء جلسة جديدة. فإذا عطّلت ذلك بـ `ASTUR_IOS_AGENT_REAP=0`، فاقتل المتبقّي يدويًا:

  ```bash
  pkill -f "xcodebuild.*AsturIOSAgent"
  ```

- **تأكد من أن الوكيل يخدم الأوامر.** أعد التشغيل مع تتبّع الجسر؛ ومن المفترض أن ترى أسطر `response-ok tree.get` و `response-ok device.screenshot`:

  ```bash
  ASTUR_IOS_AGENT_TRACE=1 npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
  ```

  فإذا سُلّمت الأوامر ولم تصل استجابات أبدًا، فالأرجح أن التطبيق قيد الاختبار عالق في حالة غير خاملة (حركة أو فيديو يدور) — راجع [أداء iOS واستقراره](../ios/).
- **وما زال لا شيء؟** تأكد من أنك على البناء الحالي (`npm run build` عند التشغيل من المصدر)، ثم حدّث تبويب المتصفح تحديثًا قسريًا.

## شجرة الواجهة فارغة في الـ Inspector على iOS

العَرَض:

```text
UI tree unavailable
```

لقطة الشاشة المعروضة ظاهرة، لكن لوحة شجرة الواجهة فارغة.

الحل:

- تأكد من إقلاع المحاكي وتثبيت التطبيق
- مرّر معرّف الحزمة عبر `--app-id` أو `ASTUR_IOS_BUNDLE_ID` أو `Controls` في الـ Inspector
- أبقِ مشروع `agents/ios-xctest-agent` متاحًا عند التشغيل من المصدر
- ارفع `agent.launchTimeout` إذا كان Xcode يبدأ مشغّل الاختبار من حالة باردة لأول مرة

## وضع الوكيل الإلزامي على Android بلا نقطة نهاية

العَرَض:

```text
ANDROID_AGENT_ENDPOINT_REQUIRED
```

الحل:

- اضبط `use.astur.agent.endpoint`
- أو اضبط `ASTUR_ANDROID_AGENT_ENDPOINT`
- أو انتقل إلى `agent.mode: 'auto'` أثناء الانتقال

## وضع الوكيل الإلزامي على iOS بلا نقطة نهاية

العَرَض:

```text
IOS_XCTEST_AGENT_ENDPOINT_REQUIRED
```

الحل:

- اضبط `use.astur.agent.endpoint`
- أو اضبط `ASTUR_IOS_AGENT_ENDPOINT`
- أو انتقل إلى `agent.mode: 'auto'` أثناء الانتقال

## فشل مصافحة الوكيل في الوضع الإلزامي

العَرَض:

```text
ANDROID_AGENT_CONNECT_FAILED
```

أو

```text
IOS_XCTEST_AGENT_CONNECT_FAILED
```

الحل:

- تحقّق من رابط نقطة النهاية ومنفذها
- تحقّق من تطابق منصة نقطة النهاية مع منصة الجلسة الحالية
- تحقّق من أن نقطة النهاية تقبل مغلّفات أوامر HTTP POST
- ارفع `agent.launchTimeout` للبيئات الأبطأ في البدء

## فشل أمر الوكيل في الوضع الإلزامي

العَرَض:

```text
ANDROID_AGENT_COMMAND_FAILED
```

أو

```text
IOS_XCTEST_AGENT_COMMAND_FAILED
```

الحل:

- تحقّق من الأمر المستهدف في تطبيق الوكيل على الجهاز
- تأكد من مطابقة بيانات المحدِّد أو الإجراء لمخطّط الوكيل المتوقّع
- افحص سجلات الوكيل على الخادم بحثًا عن أعطال على مستوى الأوامر
- شغّل مؤقتًا بـ `agent.mode: 'auto'` أثناء تشخيص تغطية أوامر نقطة النهاية

## تخطّي iOS على Linux و Windows

العَرَض:

```text
SKIP iOS platform
```

وهذا صحيح. فأتمتة iOS محليًا تتطلب macOS مع Xcode.
