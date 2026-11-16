// User-facing Arabic messages for Week 6/7 features (client-safe;
// also used by the standalone Worker, so no server-only imports here).
export const AR = {
  notSignedIn: "يجب تسجيل الدخول أولًا.",
  forbidden: "ليست لديك صلاحية لتنفيذ هذا الإجراء.",
  notFound: "المحتوى غير موجود أو غير متاح لك.",
  invalidRequest: "الطلب غير صالح.",
  serverError: "حدث خطأ غير متوقع. حاول مرة أخرى.",

  commentRequired: "لا يمكن إضافة تعليق فارغ.",
  commentTooLong: "التعليق أطول من الحد المسموح (2000 حرف).",
  commentFailed: "تعذّر حفظ التعليق. حاول مرة أخرى.",
  commentDeleteFailed: "تعذّر حذف التعليق. حاول مرة أخرى.",

  bookmarkFailed: "تعذّر حفظ العنصر في المحفوظات. حاول مرة أخرى.",
  bookmarkDuplicate: "هذا العنصر محفوظ بالفعل في المحفوظات.",
  bookmarkMissing: "هذا العنصر غير موجود في محفوظاتك.",

  fileMissing: "يرجى اختيار ملف للرفع.",
  fileUnsupported: "نوع الملف غير مدعوم. يُسمح فقط بملفات PDF أو TXT.",
  fileTooLarge: "حجم الملف أكبر من الحد المسموح (10 ميجابايت).",
  fileEmpty: "الملف فارغ.",
  fileContentMismatch: "محتوى الملف لا يطابق نوعه (PDF أو نص عادي).",
  uploadFailed: "تعذّر رفع الملف. حاول مرة أخرى.",
  fileUnavailable: "الملف غير متوفر حاليًا.",
  fileDeleteFailed: "تعذّر حذف الملف. حاول مرة أخرى.",

  // Week 7: background processing (Worker)
  processingQueueUnavailable:
    "تم حفظ الملف، لكن تعذّر إرسال مهمة المعالجة الآن. استخدم زر إعادة المحاولة لاحقًا.",
  processingRetrying:
    "حدث خطأ مؤقت أثناء معالجة الملف. ستتم إعادة المحاولة تلقائيًا.",
  processingFailed:
    "فشلت معالجة الملف بعد عدة محاولات. يمكنك إعادة المحاولة.",
  processingEmptyText: "الملف لا يحتوي على نص قابل للبحث.",
  processingNoPdfText:
    "لم يتم العثور على نص قابل للاستخراج في ملف PDF (قد يكون صورة أو مستندًا ممسوحًا ضوئيًا). التعرّف الضوئي على النص (OCR) غير مدعوم.",
  processingPdfUnreadable: "تعذّر قراءة ملف PDF. قد يكون تالفًا أو محميًا بكلمة مرور.",
  fileRetryNotAllowed: "يمكن إعادة المحاولة فقط للملفات الفاشلة والمفعّلة.",
  fileRetryFailed: "تعذّر إعادة إرسال الملف للمعالجة. حاول مرة أخرى لاحقًا.",
  fileUpdateFailed: "تعذّر تحديث الملف. حاول مرة أخرى.",
  fileDisabled: "هذا الملف معطّل حاليًا.",

  searchQueryRequired: "اكتب كلمة للبحث.",
  searchQueryTooLong: "كلمة البحث طويلة جدًا (100 حرف كحد أقصى).",
  searchInvalidFilter: "قيمة الفلتر غير صالحة.",
  searchFailed: "تعذّر تنفيذ البحث. حاول مرة أخرى.",

  // Week 8: Semantic Search / semantic indexing
  semanticQueryTooLong: "سؤال البحث الدلالي طويل جدًا (300 حرف كحد أقصى).",
  semanticSearchUnavailable:
    "البحث الدلالي غير متاح حاليًا. استخدم البحث بالكلمات المفتاحية أو حاول لاحقًا.",
  semanticIndexRetrying:
    "تعذّرت فهرسة المحتوى للبحث الدلالي مؤقتًا. ستتم إعادة المحاولة تلقائيًا.",
  semanticIndexFailed:
    "تعذّرت فهرسة المحتوى للبحث الدلالي بعد عدة محاولات.",

  specialtyTooLong: "التخصص أطول من الحد المسموح (100 حرف).",
  profileReadOnlyField: "لا يمكن تعديل الدور أو القسم أو البيانات الأساسية من الملف الشخصي. يمكنك تعديل التخصص فقط.",
  profileFailed: "تعذّر حفظ الملف الشخصي. حاول مرة أخرى.",
} as const;
