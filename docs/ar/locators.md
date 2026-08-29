# المُحدِّدات (Locators)

المُحدِّد يصف **كيفية العثور** على العنصر، لا العنصر ذاته. ولا يُنفَّذ أي استعلام فعلي حتى تقوم بإجراء أو تأكيد (Assertion) عليه، ما يعني أن المُحدِّد يبقى صالحاً حتى لو أُعيد رسم الشاشة من تحته.

```ts
await device.getByRole('button', { name: 'Sign In' }).tap();
```

## العثور على عنصر واحد

| الدالة | تطابق |
| --- | --- |
| `getByTestId(id)` | مُعرّف إمكانية الوصول أو `resource-id`. وهو الخيار الأكثر ثباتاً |
| `getById(id)` | مطابق لـ `getByTestId` |
| `getByLabel(text)` | تسمية إمكانية الوصول (`contentDescription` على Android) |
| `getByText(text)` | النص الظاهر للمستخدم |
| `getByRole(role, { name })` | الدور الدلالي (Semantic Role)، مع إمكانية التصفية بالاسم |
| `getByType(type)` | نوع العنصر على المنصة |
| `getByPlaceholder(text)` | النص الإرشادي (Placeholder) لحقل فارغ |

كل دالة تقبل الخيار `{ exact: false }` للمطابقة الجزئية، كما تقبل `getByText` تعبيراً نمطياً (RegExp).

### ملاحظة حول `getByPlaceholder`

لا تُصنّف أيٌّ من المنصتين النص الإرشادي كحقل من حقول إمكانية الوصول، لذا يقرأه Astur من السمات الخام (Raw Attributes) للمشغّل حيثما توفّرت (`hint` على Android و `placeholderValue` على iOS)، وإلا فإنه يعود إلى قيمة أو تسمية الحقل **الفارغ** — وهي الطريقة التي يظهر بها النص الإرشادي في حقل لم يكتب فيه أحد بعد.

يترتب على ذلك أمر يجدر الانتباه له: بمجرد أن يمتلئ الحقل بمحتوى، فإنه لن يطابق نصه الإرشادي بعد الآن. وهذا سلوك مقصود، لأن البديل — أي مطابقة حقل بنص إرشادي لم يعد معروضاً — يجعل الاختبار ينجح بينما يؤكد أمراً غير صحيح.

## تضييق نطاق البحث

الشاشة المليئة بصفوف متكررة هي الحالة الطبيعية في تطبيقات الجوال، ولا يوجد مُحدِّد مفرد قادر على التمييز بينها. الحل هو التركيب (Composition).

### الحصر داخل عنصر أب

يمكن لأي مُحدِّد أن يبحث داخل مُحدِّد آخر. ويقتصر البحث على العناصر المتفرعة (Descendants) من ذلك الأب — فالأب لا يطابق نفسه أبداً.

```ts
const row = device.getByType('Cell').filter({ hasText: 'Rye' });
await row.getByRole('button', { name: 'Add' }).tap();
```

### التصفية عبر `filter()`

```ts
locator.filter({ hasText: 'In stock' })
locator.filter({ hasNotText: /sold\s+out/i })
locator.filter({ has: device.getByRole('button') })
locator.filter({ hasNot: device.getByText('Ad') })
```

يفحص كل من `hasText` و `hasNotText` العنصر **وكل ما يندرج تحته**، وبذلك يطابق الصف بناءً على نصوص أبنائه. ويقبل كلاهما نصاً عادياً (مطابقة جزئية) أو تعبيراً نمطياً.

وتتراكم عوامل التصفية، إذ يجب أن تتحقق جميعها:

```ts
device.getByType('Cell')
  .filter({ hasText: 'In stock' })
  .filter({ hasNot: device.getByText('Pre-order') })
```

### الدمج المنطقي عبر `and()` و `or()`

```ts
device.getByRole('button').and(device.getByLabel('Add'))   // يجب تحقق الشرطين
device.getByText('Retry').or(device.getByText('Try again'))  // أيٌّ منهما
```

تُعيد `or()` النتائج بترتيب ظهورها في الشجرة، ولا تكرر عنصراً طابقه الطرفان معاً.

### التحديد بالموضع

```ts
locator.first()
locator.last()
locator.nth(2)
locator.nth(-1)   // القيم السالبة تُحسب من النهاية
```

يُطبَّق الموضع **في النهاية**، بعد الحصر والتصفية. لذا فإن `filter(...).first()` تعني «الأول ضمن المجموعة المُصفّاة»، لا «أول تطابق، إن نجا من التصفية» — وهو المعنى المقصود في الغالبية العظمى من الحالات.

## التنفيذ والتأكيد

```ts
await locator.tap()
await locator.fill('qa@astur.dev')
await locator.clear()
await locator.scrollIntoView()
await locator.screenshot()
```

```ts
await locator.count()
await locator.isVisible()
await locator.isChecked()
await locator.isEmpty()
await locator.textContent()
await locator.waitFor({ state: 'visible' })
```

تُطلق `isChecked()` خطأً بدلاً من إرجاع `false` عندما لا يُبلّغ العنصر عن حالة تحديد إطلاقاً. فعبارة «هذا ليس عنصر تحديد» تختلف تماماً عن «هذا العنصر غير محدد»، ودمجهما بصمت يحوّل مُحدِّداً مُوجَّهاً بشكل خاطئ إلى تأكيد ناجح.

أما تأكيدات المطابقة فتعيد المحاولة حتى تتحقق أو تنتهي المهلة:

```ts
await expect(locator).toBeVisible();
await expect(locator).toBeChecked();
await expect(locator).toBeEmpty();
await expect(locator).toHaveText('Welcome back');
```

## القيود

| القيد | السبب |
| --- | --- |
| **المُحدِّد المُركّب يكلّف قراءة إضافية واحدة للشجرة** | التركيب مرتبط بالشجرة ككل، لذا يُحل مقابل لقطة واحدة بدلاً من تمريره إلى المشغّل. أما المُحدِّدات البسيطة فتسلك مسار المشغّل السريع دون تغيير |
| **تتطلب `fill()` على مُحدِّد مُركّب أن يكون العنصر قابلاً للتسمية** | إذا كان العنصر يحمل مُعرّفاً أو تسمية أو نصاً فريداً، يمرر Astur للمشغّل مُحدِّداً بسيطاً ويعمل بشكل مطابق تماماً. أما إذا لم يميّزه شيء — كحقل داخل واحد من صفوف متطابقة — فيتم النقر عليه لتركيز المؤشر ثم الكتابة، وهو ما لا يسمح بمسح محتوى الحقل أولاً. ويُبلَّغ عن تعذّر ذلك باسم `COMPOSED_LOCATOR_FILL_UNSUPPORTED` |
| **حالة التحديد لا تُبلّغ عنها كل المشغّلات** | يقرأها Android من `checkable` و `checked`. وفي غير ذلك تُشتق من قيمة عنصر التبديل. والعنصر الذي لا يجيب عن أيٍّ منهما تُسجَّل حالته كـ «غير معروفة» |
| **`by.xpath` محجوزة وغير مُنفَّذة** | استخدم `by.native({ ios, android })` لما تعجز عنه الدوال الدلالية |

## مخرج الطوارئ

حين يعجز أي مُحدِّد دلالي عن التعبير عن الهدف — وغالباً ما يكون ذلك في شاشة خالية من بيانات إمكانية الوصول — تمرر `by.native()` استعلاماً خاصاً بالمنصة مباشرةً إلى الوكيل (Agent):

```ts
device.find(by.native({
  ios: "type == 'Button' AND label CONTAINS 'Save'",
  android: { className: 'android.widget.Button', textContains: 'Save' }
}));
```

كما تدعم نسخة Android الخيارين `hasChild` و `hasDescendant` للمطابقة البنيوية. يُفضَّل استخدام التركيب المذكور أعلاه، ولا يُلجأ إلى هذا المخرج إلا حين لا تحمل الشجرة أي بيانات دلالية يمكن البناء عليها.
