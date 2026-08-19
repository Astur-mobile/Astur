# المتطلبات

يتجنّب Astur خادم Appium عن قصد، لكنه ما زال يعتمد على أدوات المنصات الأصلية التي يوفّرها Android و iOS.

## دعم المضيف

| نظام المضيف | محاكي/جهاز Android | محاكي iOS | جهاز iOS حقيقي |
| --- | --- | --- | --- |
| macOS | نعم | نعم | نعم |
| Linux | نعم | لا | لا يوجد دعم محلي |
| Windows | نعم | لا | لا يوجد دعم محلي |

تتطلب أتمتة iOS محليًا نظام macOS، لأن محاكي Apple و Xcode و `xcrun` و `simctl` و `xcodebuild` و XCTest متاحة على macOS فقط.

## مطلوب لجميع المستخدمين

- ‏Node.js إصدار 18 أو أحدث
- ‏npm إصدار 9 أو أحدث
- ‏Playwright Test، ويُثبَّت عبر `@astur-mobile/test`
- طرفية (terminal) تصل إلى أدوات المنصة عبر `PATH`

للتحقق:

```bash
node --version
npm --version
npx astur-mobile doctor
```

## مطلوب لـ Android

- ‏Android SDK
- ‏Android SDK Platform Tools
- وجود `adb` في `PATH`
- محاكي Android واحد على الأقل أو جهاز Android موصول عبر USB
- تفعيل تنقيح USB (‏USB debugging) على الأجهزة الحقيقية

متغيرات البيئة المقترحة:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

على مستخدمي Linux و Windows تعديل المسارات بما يوافق موقع Android SDK لديهم.

للتحقق:

```bash
adb version
adb devices -l
npx astur-mobile devices --android
```

## مطلوب لـ iOS

يعمل iOS على macOS فقط. اختر العمود الذي يوافق هدفك — مسار المحاكي **لا يحتاج توقيع Apple**، أما مسار الجهاز الحقيقي فيحتاجه.

| المتطلب | محاكي iOS | iPhone / iPad حقيقي |
| --- | :---: | :---: |
| ‏macOS مع Xcode (يُفتح مرة وتُقبل الرخصة) | مطلوب | مطلوب |
| أدوات سطر أوامر Xcode (`xcrun`, `simctl`, `xcodebuild`) | مطلوب | مطلوب |
| تثبيت **بيئة تشغيل المحاكي** من Xcode | مطلوب | — |
| ‏`devicectl` (يأتي مع Xcode) | — | مطلوب |
| ملف التطبيق | ملف **`.app`** مبني للمحاكي | ملف **`.ipa`** موقّع للجهاز |
| **فريق التوقيع** لدى Apple (`ASTUR_IOS_DEVELOPMENT_TEAM`) | غير مطلوب | **مطلوب** |
| الجهاز موثوق مع تفعيل **وضع المطوّر** | — | مطلوب |
| وكيل XCUITest المرفق | يبنيه Astur ويشغّله تلقائيًا | يبنيه Astur و **يوقّعه** ويشغّله تلقائيًا |

> لا يُثبَّت الوكيل يدويًا أبدًا. يبني Astur مشغّل XCUITest المرفق بلغة Swift ويشغّله عبر Xcode في كل جلسة. وعلى الأجهزة الحقيقية يوقّعه أيضًا بفريقك — وهي الخطوة الوحيدة التي تتخطّاها المحاكيات.

للتحقق من سلسلة الأدوات:

```bash
xcodebuild -version
xcrun simctl list devices available   # المحاكيات
xcrun devicectl list devices          # الأجهزة الحقيقية
npx astur-mobile devices --ios
npx astur-mobile doctor --verbose
```

اختر مسار iOS الذي تحتاجه فعلًا قبل أي إعداد إضافي:

| الهدف | تحتاج بناء تطبيقك أولًا؟ | الملف الذي يتوقعه Astur | يحتاج توقيع Apple؟ | مثال من هذا المستودع |
| --- | --- | --- | --- | --- |
| تشغيل الـ Inspector وتوليد الكود على محاكي والتأكد من سلسلة أدوات iOS | لا (نزّل تطبيق العرض `.app`) | `Astur.app` | لا | `npx astur-mobile codegen --ios --simulator --app ./Astur.app --app-id com.astur.demo` |
| تشغيل تطبيقك أنت على محاكي | نعم | ملف `.app` مبني للمحاكي | لا | اضبط `app.path` في إعداداتك ثم `npx astur-mobile test` |
| التشغيل على iPhone أو iPad حقيقي | نعم | ملف `.ipa` موقّع للجهاز | نعم. اضبط `ASTUR_IOS_DEVELOPMENT_TEAM` واستخدم تطبيقًا موقّعًا للجهاز. | `npx astur-mobile codegen --ios --real --device <device-udid> --app ./MyApp.ipa --app-id com.example.myapp` |

> تطبيق العرض المذكور أعلاه (`Astur.app` / `astur.demo.ios.ipa`، بمعرّف الحزمة `com.astur.demo`) موجود في مستودع أمثلة Astur — وهو مفيد لتجربة أولى قبل ربط بنائك الخاص.

الفرق المهم في الملفات بسيط: محاكي iOS يستخدم `.app`، والأجهزة الحقيقية تستخدم `.ipa`.

لست بحاجة إلى خادم Appium منفصل، ولا إضافة WebDriver، ولا مشغّل XCTest مثبّت يدويًا. يرفق Astur وكيل XCUITest بلغة Swift ويشغّله عبر Xcode عند الحاجة.

إذا شغّلت بـ `--app-id` وحده والتطبيق غير مثبّت، يفشل Astur فورًا بالخطأ `IOS_APP_NOT_INSTALLED`. في التشغيل الأول مرّر `--app /path/to/Your.app` على المحاكي أو `--app /path/to/Your.ipa` على الجهاز الحقيقي كي يتمكّن Astur من تثبيته قبل الاتصال.

لا تثبّت وكيل iOS الخاص بـ Astur يدويًا. فهو يهيّئ وكيل XCUITest المرفق تلقائيًا في جلسات المحاكي والجهاز الحقيقي على حد سواء.

للأجهزة الحقيقية، اضبط أيضًا:

- حساب Apple Developer داخل Xcode
- جهاز iPhone أو iPad موصول عبر USB وموثوق
- تفعيل وضع المطوّر (Developer Mode) على الجهاز
- تطبيقًا موقّعًا لذلك الجهاز تحديدًا
- ضبط `ASTUR_IOS_DEVELOPMENT_TEAM` على معرّف فريقك لدى Apple

بيئة مقترحة للأجهزة الحقيقية:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
# اختياري: اضبط هذا فقط عندما يعجز الهاتف عن الوصول إلى الجسر الذي يكتشفه Astur تلقائيًا.
export ASTUR_IOS_AGENT_HOST=192.168.0.14
```

لا تحتاج المحاكيات إلى `ASTUR_IOS_DEVELOPMENT_TEAM` ولا إلى شهادة Apple Development.

يوقّع Astur مشغّل XCUITest المرفق ويشغّله تلقائيًا، لكن Apple تشترط أن يأتي فريق التوقيع من جهازك أو من أسرار CI. وعند التشغيل من مستودع المصدر يستطيع Astur استنتاج الفريق من `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` إذا كان المشروع موقّعًا في Xcode. أما في تثبيتات npm و CI فاضبط `ASTUR_IOS_DEVELOPMENT_TEAM`.

تتواصل الأجهزة الحقيقية الموصولة عبر USB في العادة من خلال نفق CoreDevice في Xcode. اترك `ASTUR_IOS_AGENT_HOST` دون ضبط ما لم تكن تريد عمدًا أن يتصل الهاتف بعنوان شبكة محدّد لجهاز Mac.

### DOM داخل WebView على iOS (اختياري)

مطلوب فقط إذا كنت تقود محتوى **DOM** داخل WebView (`device.webContext()` / `webview()`) على iOS. أما المحدِّدات الأصلية على شاشات WebView فلا تحتاج شيئًا من هذا.

- ‏`brew install ios-webkit-debug-proxy` (الإصدار 1.9 فأعلى — دعم المحاكي يستخدم وضع `-s` فيه)
- أن يضبط التطبيق `WKWebView.isInspectable = true` (‏iOS/iPadOS 16.4 فأعلى)
- على الأجهزة الحقيقية فقط: الإعدادات ▸ Safari ▸ متقدم ▸ Web Inspector = مفعّل

يعمل على محاكي iOS والأجهزة الحقيقية معًا؛ ويعثر Astur تلقائيًا على مقبس Web Inspector الخاص بالمحاكي.

## مطلوب لـ Flutter

يقود Astur تطبيقات Flutter دون Appium ودون مشغّل خارجي خاص بـ Flutter.

- **‏Flutter على Android** — وجّه إعداداتك إلى حزمة APK من نوع **debug** (أو profile)؛ فبنية release لا تملك خدمة Dart VM ولا يمكن قيادتها. تحتاج أيضًا أمر `flutter` في `PATH` (أو `ASTUR_FLUTTER_PATH`) وضبط `ASTUR_FLUTTER_PROJECT` على مجلد مصدر تطبيق Flutter (المجلد الذي يحوي `pubspec.yaml`).
- **‏Flutter على iOS** — يُقرأ عبر شجرة إمكانية الوصول في XCUITest (لا توجد خدمة Dart VM)؛ جهّز `Runner.app` مبنيًا للمحاكي وفعّل الـ semantics حتى تُكشف المعرّفات والتسميات.
- امنح الودجات معرّفًا ثابتًا `Semantics(identifier: 'login-email-input')` كي يجدها `getById()`؛ بينما يطابق `getByText` و `getByLabel` نصوص `Text` والتسميات.

راجع [Flutter و React Native](../frameworks/) للدليل الكامل، و[حدود المنصات](../platform-limits/) لمعرفة ما تستثنيه كل منصة.

## حدود الإصدار التجريبي الحالي

- تعتمد أتمتة Android الأصلية افتراضيًا على وكيل Kotlin UIAutomator المرفق في البحث عن المحدِّدات والانتظار والإجراءات والإيماءات والتحكم بلوحة المفاتيح وفحص شجرة الواجهة.
- ما زال Android يستخدم ADB لمهام دورة الحياة مثل الاكتشاف والتثبيت والتشغيل والتقاط السجلات ولقطات الشاشة والفيديو وتمرير المنافذ.
- ما زال المسار الاحتياطي القديم (ADB/UIAutomator XML) متاحًا أثناء الانتقال، لكنه ليس المسار المفضّل.
- تعمل أتمتة DOM داخل WebView على Android عبر Chrome DevTools Protocol متى فعّل التطبيق تنقيح WebView (`setWebContentsDebuggingEnabled(true)`).
- تعمل أتمتة العناصر الأصلية على محاكي iOS والأجهزة الحقيقية عبر وكيل XCUITest المرفق بلغة Swift.
- تستخدم محاكيات iOS الأمر `simctl` لمهام دورة الحياة، بينما تستخدم الأجهزة الحقيقية `devicectl`.
- تتطلب أجهزة iOS الحقيقية توقيع مشغّل XCUITest عبر `ASTUR_IOS_DEVELOPMENT_TEAM`.
- تبقى أذونات iOS الحقيقية ومسح الذاكرة/البيانات مباشرةً والقفل وفتح القفل وتسجيل الفيديو محدودة بأدوات Apple العامة. استخدم إعادة التثبيت للتصفير ولقطات الشاشة حيث لا تتوفر هذه الواجهات. وإذا فُعّل تسجيل الفيديو الأصلي في تشغيل على جهاز iOS حقيقي، يرفق Astur مرفقًا يوضّح تخطّي الفيديو بدل إفشال الاختبار.
- تعمل أتمتة DOM داخل WebView (‏WKWebView) على **المحاكي والأجهزة الحقيقية** عبر `ios-webkit-debug-proxy` (‏1.9 فأعلى) و `WKWebView.isInspectable = true` (‏iOS 16.4 فأعلى). كما تعمل المحدِّدات الأصلية على شاشات WebView أيضًا.

## متطلبات اختيارية لنقطة نهاية الوكيل الأصلي

يشغّل Astur وكلاءه الأصليين المرفقين تلقائيًا في التشغيل المحلي المعتاد. ولا تحتاج نقطة نهاية صريحة إلا إذا كنت تتصل بوكيل منصة شغّلته بنفسك بشكل منفصل، أو تشخّص سلوك النقل.

- نقطة نهاية وكيل يمكن الوصول إليها للمنصة المستهدفة
- وكيل المنصة المطابق على تلك النقطة (نقطة `android` لجلسات Android، ونقطة `ios` لجلسات iOS)
- قيم مهلة أوامر تناسب بيئتك، إن كنت ستتجاوز القيم الافتراضية

متغيرات البيئة المعتادة:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

السياسة الافتراضية على المنصتين هي «الوكيل أولًا»:

- ‏Android: ‏`automation.engine: 'agent'`، `agent.mode: 'required'`، `legacyFallback: 'never'`، `startupTimeoutMs: 30_000`، `commandTimeoutMs: 20_000`.
- ‏iOS: ‏`automation.engine: 'agent'`، `agent.mode: 'required'`، `legacyFallback: 'never'`، `startupTimeoutMs: 60_000`، `commandTimeoutMs: 15_000`.

يمكنك العودة إلى مسار ADB/UIAutomator القديم على Android عبر `automation.engine: 'auto'` (وهو ما يضبط `legacyFallback: 'on-agent-failure'`). وتستطيع تجاوز هذه القيم في `use.astur.automation` أو `use.astur.agent`، لكن معظم المشاريع ينبغي أن تتركها دون تغيير.
