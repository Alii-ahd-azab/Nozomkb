// User-facing Arabic messages for Week 6 features (client-safe).
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

  searchQueryRequired: "اكتب كلمة للبحث.",
  searchQueryTooLong: "كلمة البحث طويلة جدًا (100 حرف كحد أقصى).",
  searchInvalidFilter: "قيمة الفلتر غير صالحة.",
  searchFailed: "تعذّر تنفيذ البحث. حاول مرة أخرى.",

  specialtyTooLong: "التخصص أطول من الحد المسموح (100 حرف).",
  profileReadOnlyField: "لا يمكن تعديل الدور أو القسم أو البيانات الأساسية من الملف الشخصي. يمكنك تعديل التخصص فقط.",
  profileFailed: "تعذّر حفظ الملف الشخصي. حاول مرة أخرى.",
} as const;
