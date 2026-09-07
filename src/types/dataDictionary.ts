/**
 * 49-Field Data Dictionary Types & Business Rules
 * แปลงจากไฟล์ โครงสร้างข้อมูล.xlsx
 */

export interface CrimeIncident {
  id: number; // 1. ลำดับ (Not Null)
  news_type: string; // 2. ประเภทข่าว (Controlled)
  url: string; // 3. ลิงก์ (Not Null, ; separated)
  news_agency: string; // 4. สำนักข่าว (Not Null, ; separated)
  news_title: string; // 5. พาดหัวข่าว (Not Null, ; separated)
  incident_date: string; // 6. วันที่เกิดเหตุ (YYYY-MM-DD)
  incident_time: string; // 7. เวลาเกิดเหตุ (HH:mm)
  province: string; // 8. จังหวัด
  district: string; // 9. อำเภอ
  sub_district: string; // 10. ตำบล
  incident_location: string; // 11. สถานที่เกิดเหตุ (Controlled)
  location_other: string; // 12. สถานที่เกิดเหตุ: อื่นๆ ระบุ
  perpetrator_name: string; // 13. ผู้ก่อเหตุ : ชื่อ - สกุล
  perpetrator_gender: string; // 14. ผู้ก่อเหตุ : เพศ (ชาย, หญิง, LGBTQ+)
  perpetrator_age: number | null; // 15. ผู้ก่อเหตุ : อายุ (ปี · ไม่ทราบให้เว้นว่าง ห้ามใส่ 0)
  perpetrator_occupation: string; // 16. ผู้ก่อเหตุ : ประกอบอาชีพ (ใช่, ไม่ใช่)
  perpetrator_occupation_detail: string; // 17. อาชีพผู้ก่อเหตุ: ระบุ
  perpetrator_weapon: string; // 18. ผู้ก่อเหตุ : อาวุธ (Controlled)
  alcohol_test_method: string; // 19. วิธีตรวจแอลกอฮอล์ (Controlled)
  alcohol_level: number | null; // 20. ระดับแอลกอฮอล์ที่ตรวจได้ (mg%) (เว้นว่างเมื่อ สังเกตุอาการ)
  drinking_location: string; // 21. สถานที่ดื่มก่อนเกิดเหตุ
  beverage_type: string; // 22. ประเภทเครื่องดื่ม (Controlled)
  test_duration: number | null; // 23. ระยะเวลาจากเกิดเหตุถึงเวลาตรวจ (นาที)
  recidivism: string; // 24. กระทำความผิดซ้ำ (ใช่, ไม่ใช่)
  drug_use: string; // 25. มีการใช้ยาเสพติด (ใช่, ไม่ใช่)
  drug_use_detail: string; // 26. มีการใช้ยาเสพติด: ระบุ (; separated)
  total_affected: number | null; // 27. จำนวนผู้ได้รับผลกระทบ
  total_death: number | null; // 28. จำนวนผู้เสียชีวิต
  total_injury: number | null; // 29. จำนวนผู้บาดเจ็บ
  public_property_damage: string; // 30. ทรัพย์สินสาธารณะ (; separated)
  victim_1_name: string; // 31. เหยื่อ1 : ชื่อ - สกุล
  victim_1_gender: string; // 32. เหยื่อ1 : เพศ (ชาย, หญิง, LGBTQ+)
  victim_1_age: number | null; // 33. เหยื่อ1 : อายุ (ปี · ไม่ทราบให้เว้นว่าง ห้ามใส่ 0)
  victim_1_occupation: string; // 34. เหยื่อ1 : อาชีพ
  victim_1_injury_type: string; // 35. เหยื่อ1 : ลักษณะบาดเจ็บ (Controlled)
  victim_1_relation_to_perpetrator: string; // 36. เหยื่อ1 : มีความสัมพันธ์กับคู่กรณี (ใช่, ไม่ใช่)
  victim_2_name: string; // 37. เหยื่อ2 : ชื่อ - สกุล
  victim_2_gender: string; // 38. เหยื่อ2 : เพศ (ชาย, หญิง, LGBTQ+)
  victim_2_age: number | null; // 39. เหยื่อ2 : อายุ (ปี · ไม่ทราบให้เว้นว่าง ห้ามใส่ 0)
  victim_2_occupation: string; // 40. เหยื่อ2 : อาชีพ
  victim_2_injury_type: string; // 41. เหยื่อ2 : ลักษณะบาดเจ็บ (Controlled)
  victim_2_relation_to_perpetrator: string; // 42. เหยื่อ2 : มีความสัมพันธ์กับคู่กรณี (ใช่, ไม่ใช่)
  victim_3_name: string; // 43. เหยื่อ3 : ชื่อ - สกุล
  victim_3_gender: string; // 44. เหยื่อ3 : เพศ (ชาย, หญิง, LGBTQ+)
  victim_3_age: number | null; // 45. เหยื่อ3 : อายุ (ปี · ไม่ทราบให้เว้นว่าง ห้ามใส่ 0)
  victim_3_occupation: string; // 46. เหยื่อ3 : อาชีพ
  victim_3_injury_type: string; // 47. เหยื่อ3 : ลักษณะบาดเจ็บ (Controlled)
  victim_3_relation_to_perpetrator: string; // 48. เหยื่อ3 : มีความสัมพันธ์กับคู่กรณี (ใช่, ไม่ใช่)
  news_summary: string; // 49. สรุปข่าวโดยย่อ (Not Null)
}

export type FieldCategory =
  | 'news_meta'
  | 'location_time'
  | 'perpetrator'
  | 'alcohol_drugs'
  | 'impact_damage'
  | 'victims'
  | 'summary';

export interface DataDictionaryFieldDef {
  index: number;
  fieldThai: string;
  fieldEnglish: keyof CrimeIncident;
  dataType: 'int' | 'str' | 'datetime';
  missing: 'Null' | 'Not Null';
  controlledVocab?: string[];
  notes?: string;
  category: FieldCategory;
  categoryThai: string;
  isMultiValue?: boolean;
}

// Controlled Vocabularies
export const NEWS_TYPES = [
  'อุบัติเหตุเมาขับ',
  'ทำร้ายร่างกายผู้อื่น',
  'ทำร้ายตนเอง',
  'ข่มขืน ล่วงละเมิด',
  'ทำลายทรัพย์สิน',
] as const;

export const INCIDENT_LOCATIONS = [
  'ถนนสายหลัก/ทางหลวง',
  'ถนนสายรอง/ทางหลวงชนบท',
  'ถนนในหมู่บ้าน',
  'บ้าน/ที่อยู่อาศัย',
  'ที่สาธารณะ',
  'โรงแรม',
  'สถานบริการ/สถานบันเทิง',
  'สถานที่จัดงาน/งานเทศกาล',
  'อื่นๆ',
] as const;

export const GENDERS = ['ชาย', 'หญิง', 'LGBTQ+'] as const;

export const YES_NO = ['ใช่', 'ไม่ใช่'] as const;

export const WEAPONS = [
  'รถจักรยานยนต์',
  'รถยนต์',
  'จักรยาน',
  'รถอื่นๆ',
  'มีด',
  'ปืน',
  'แท่งเหล็ก/ไม้',
  'อื่นๆ',
] as const;

export const ALCOHOL_TEST_METHODS = [
  'เป่าแอลกอฮอล์',
  'เจาะเลือดตรวจแอลกอฮอล์',
  'สังเกตุอาการ',
] as const;

export const BEVERAGE_TYPES = [
  'สุราขาว/สุราสี',
  'เบียร์',
  'ไวน์',
  'อื่นๆ',
] as const;

export const INJURY_TYPES = [
  'บาดเจ็บเล็กน้อย',
  'บาดเจ็บสาหัส',
  'เสียชีวิต',
] as const;

export const DATA_DICTIONARY_FIELDS: DataDictionaryFieldDef[] = [
  {
    index: 1,
    fieldThai: 'ลำดับ',
    fieldEnglish: 'id',
    dataType: 'int',
    missing: 'Not Null',
    notes: 'ตัวระบุลำดับเหตุการณ์',
    category: 'news_meta',
    categoryThai: 'ข้อมูลข่าวและแหล่งที่มา',
  },
  {
    index: 2,
    fieldThai: 'ประเภทข่าว',
    fieldEnglish: 'news_type',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...NEWS_TYPES],
    category: 'news_meta',
    categoryThai: 'ข้อมูลข่าวและแหล่งที่มา',
  },
  {
    index: 3,
    fieldThai: 'ลิงก์',
    fieldEnglish: 'url',
    dataType: 'str',
    missing: 'Not Null',
    notes: 'มากกว่า 1 ใช้ ; คั่น',
    isMultiValue: true,
    category: 'news_meta',
    categoryThai: 'ข้อมูลข่าวและแหล่งที่มา',
  },
  {
    index: 4,
    fieldThai: 'สำนักข่าว',
    fieldEnglish: 'news_agency',
    dataType: 'str',
    missing: 'Not Null',
    notes: 'มากกว่า 1 ใช้ ; คั่น',
    isMultiValue: true,
    category: 'news_meta',
    categoryThai: 'ข้อมูลข่าวและแหล่งที่มา',
  },
  {
    index: 5,
    fieldThai: 'พาดหัวข่าว',
    fieldEnglish: 'news_title',
    dataType: 'str',
    missing: 'Not Null',
    notes: 'มากกว่า 1 ใช้ ; คั่น',
    isMultiValue: true,
    category: 'news_meta',
    categoryThai: 'ข้อมูลข่าวและแหล่งที่มา',
  },
  {
    index: 6,
    fieldThai: 'วันที่เกิดเหตุ',
    fieldEnglish: 'incident_date',
    dataType: 'datetime',
    missing: 'Null',
    category: 'location_time',
    categoryThai: 'วันเวลาและสถานที่เกิดเหตุ',
  },
  {
    index: 7,
    fieldThai: 'เวลาเกิดเหตุ',
    fieldEnglish: 'incident_time',
    dataType: 'datetime',
    missing: 'Null',
    category: 'location_time',
    categoryThai: 'วันเวลาและสถานที่เกิดเหตุ',
  },
  {
    index: 8,
    fieldThai: 'จังหวัด',
    fieldEnglish: 'province',
    dataType: 'str',
    missing: 'Null',
    category: 'location_time',
    categoryThai: 'วันเวลาและสถานที่เกิดเหตุ',
  },
  {
    index: 9,
    fieldThai: 'อำเภอ',
    fieldEnglish: 'district',
    dataType: 'str',
    missing: 'Null',
    category: 'location_time',
    categoryThai: 'วันเวลาและสถานที่เกิดเหตุ',
  },
  {
    index: 10,
    fieldThai: 'ตำบล',
    fieldEnglish: 'sub_district',
    dataType: 'str',
    missing: 'Null',
    category: 'location_time',
    categoryThai: 'วันเวลาและสถานที่เกิดเหตุ',
  },
  {
    index: 11,
    fieldThai: 'สถานที่เกิดเหตุ',
    fieldEnglish: 'incident_location',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...INCIDENT_LOCATIONS],
    category: 'location_time',
    categoryThai: 'วันเวลาและสถานที่เกิดเหตุ',
  },
  {
    index: 12,
    fieldThai: 'สถานที่เกิดเหตุ: อื่นๆ ระบุ',
    fieldEnglish: 'location_other',
    dataType: 'str',
    missing: 'Null',
    category: 'location_time',
    categoryThai: 'วันเวลาและสถานที่เกิดเหตุ',
  },
  {
    index: 13,
    fieldThai: 'ผู้ก่อเหตุ : ชื่อ - สกุล',
    fieldEnglish: 'perpetrator_name',
    dataType: 'str',
    missing: 'Null',
    category: 'perpetrator',
    categoryThai: 'ข้อมูลผู้ก่อเหตุ',
  },
  {
    index: 14,
    fieldThai: 'ผู้ก่อเหตุ : เพศ',
    fieldEnglish: 'perpetrator_gender',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...GENDERS],
    category: 'perpetrator',
    categoryThai: 'ข้อมูลผู้ก่อเหตุ',
  },
  {
    index: 15,
    fieldThai: 'ผู้ก่อเหตุ : อายุ',
    fieldEnglish: 'perpetrator_age',
    dataType: 'int',
    missing: 'Null',
    notes: 'ปี · ไม่ทราบให้เว้นว่าง ห้ามใส่ 0',
    category: 'perpetrator',
    categoryThai: 'ข้อมูลผู้ก่อเหตุ',
  },
  {
    index: 16,
    fieldThai: 'ผู้ก่อเหตุ : ประกอบอาชีพ',
    fieldEnglish: 'perpetrator_occupation',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...YES_NO],
    category: 'perpetrator',
    categoryThai: 'ข้อมูลผู้ก่อเหตุ',
  },
  {
    index: 17,
    fieldThai: 'อาชีพผู้ก่อเหตุ: ระบุ',
    fieldEnglish: 'perpetrator_occupation_detail',
    dataType: 'str',
    missing: 'Null',
    category: 'perpetrator',
    categoryThai: 'ข้อมูลผู้ก่อเหตุ',
  },
  {
    index: 18,
    fieldThai: 'ผู้ก่อเหตุ : อาวุธ',
    fieldEnglish: 'perpetrator_weapon',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...WEAPONS],
    category: 'perpetrator',
    categoryThai: 'ข้อมูลผู้ก่อเหตุ',
  },
  {
    index: 19,
    fieldThai: 'วิธีตรวจแอลกอฮอล์',
    fieldEnglish: 'alcohol_test_method',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...ALCOHOL_TEST_METHODS],
    category: 'alcohol_drugs',
    categoryThai: 'การตรวจแอลกอฮอล์และสารเสพติด',
  },
  {
    index: 20,
    fieldThai: 'ระดับแอลกอฮอล์ที่ตรวจได้ (mg%)',
    fieldEnglish: 'alcohol_level',
    dataType: 'int',
    missing: 'Null',
    notes: 'หน่วย mg% · ต้องเว้นว่างเมื่อ alcohol_test_method = สังเกตุอาการ · ตีความคู่กับ alcohol_test_method เสมอ',
    category: 'alcohol_drugs',
    categoryThai: 'การตรวจแอลกอฮอล์และสารเสพติด',
  },
  {
    index: 21,
    fieldThai: 'สถานที่ดื่มก่อนเกิดเหตุ',
    fieldEnglish: 'drinking_location',
    dataType: 'str',
    missing: 'Null',
    category: 'alcohol_drugs',
    categoryThai: 'การตรวจแอลกอฮอล์และสารเสพติด',
  },
  {
    index: 22,
    fieldThai: 'ประเภทเครื่องดื่ม',
    fieldEnglish: 'beverage_type',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...BEVERAGE_TYPES],
    category: 'alcohol_drugs',
    categoryThai: 'การตรวจแอลกอฮอล์และสารเสพติด',
  },
  {
    index: 23,
    fieldThai: 'ระยะเวลาจากเกิดเหตุถึงเวลาตรวจ (นาที)',
    fieldEnglish: 'test_duration',
    dataType: 'int',
    missing: 'Null',
    notes: 'จำนวนนาที นับจาก incident_time ถึงเวลาที่ตรวจ · จำเป็นต่อการตีความ alcohol_level',
    category: 'alcohol_drugs',
    categoryThai: 'การตรวจแอลกอฮอล์และสารเสพติด',
  },
  {
    index: 24,
    fieldThai: 'กระทำความผิดซ้ำ',
    fieldEnglish: 'recidivism',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...YES_NO],
    category: 'alcohol_drugs',
    categoryThai: 'การตรวจแอลกอฮอล์และสารเสพติด',
  },
  {
    index: 25,
    fieldThai: 'มีการใช้ยาเสพติด',
    fieldEnglish: 'drug_use',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...YES_NO],
    category: 'alcohol_drugs',
    categoryThai: 'การตรวจแอลกอฮอล์และสารเสพติด',
  },
  {
    index: 26,
    fieldThai: 'มีการใช้ยาเสพติด: ระบุ',
    fieldEnglish: 'drug_use_detail',
    dataType: 'str',
    missing: 'Null',
    notes: 'มากกว่า 1 ใช้ ; คั่น',
    isMultiValue: true,
    category: 'alcohol_drugs',
    categoryThai: 'การตรวจแอลกอฮอล์และสารเสพติด',
  },
  {
    index: 27,
    fieldThai: 'จำนวนผู้ได้รับผลกระทบ',
    fieldEnglish: 'total_affected',
    dataType: 'int',
    missing: 'Null',
    category: 'impact_damage',
    categoryThai: 'ผลกระทบและความเสียหาย',
  },
  {
    index: 28,
    fieldThai: 'จำนวนผู้เสียชีวิต',
    fieldEnglish: 'total_death',
    dataType: 'int',
    missing: 'Null',
    category: 'impact_damage',
    categoryThai: 'ผลกระทบและความเสียหาย',
  },
  {
    index: 29,
    fieldThai: 'จำนวนผู้บาดเจ็บ',
    fieldEnglish: 'total_injury',
    dataType: 'int',
    missing: 'Null',
    category: 'impact_damage',
    categoryThai: 'ผลกระทบและความเสียหาย',
  },
  {
    index: 30,
    fieldThai: 'ทรัพย์สินสาธารณะ',
    fieldEnglish: 'public_property_damage',
    dataType: 'str',
    missing: 'Null',
    notes: 'มากกว่า 1 ใช้ ; คั่น',
    isMultiValue: true,
    category: 'impact_damage',
    categoryThai: 'ผลกระทบและความเสียหาย',
  },
  // Victims 1
  {
    index: 31,
    fieldThai: 'เหยื่อ1 : ชื่อ - สกุล',
    fieldEnglish: 'victim_1_name',
    dataType: 'str',
    missing: 'Null',
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 32,
    fieldThai: 'เหยื่อ1 : เพศ',
    fieldEnglish: 'victim_1_gender',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...GENDERS],
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 33,
    fieldThai: 'เหยื่อ1 : อายุ',
    fieldEnglish: 'victim_1_age',
    dataType: 'int',
    missing: 'Null',
    notes: 'ปี · ไม่ทราบให้เว้นว่าง ห้ามใส่ 0',
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 34,
    fieldThai: 'เหยื่อ1 : อาชีพ',
    fieldEnglish: 'victim_1_occupation',
    dataType: 'str',
    missing: 'Null',
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 35,
    fieldThai: 'เหยื่อ1 : ลักษณะบาดเจ็บ',
    fieldEnglish: 'victim_1_injury_type',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...INJURY_TYPES],
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 36,
    fieldThai: 'เหยื่อ1 : มีความสัมพันธ์กับคู่กรณี',
    fieldEnglish: 'victim_1_relation_to_perpetrator',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...YES_NO],
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  // Victims 2
  {
    index: 37,
    fieldThai: 'เหยื่อ2 : ชื่อ - สกุล',
    fieldEnglish: 'victim_2_name',
    dataType: 'str',
    missing: 'Null',
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 38,
    fieldThai: 'เหยื่อ2 : เพศ',
    fieldEnglish: 'victim_2_gender',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...GENDERS],
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 39,
    fieldThai: 'เหยื่อ2 : อายุ',
    fieldEnglish: 'victim_2_age',
    dataType: 'int',
    missing: 'Null',
    notes: 'ปี · ไม่ทราบให้เว้นว่าง ห้ามใส่ 0',
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 40,
    fieldThai: 'เหยื่อ2 : อาชีพ',
    fieldEnglish: 'victim_2_occupation',
    dataType: 'str',
    missing: 'Null',
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 41,
    fieldThai: 'เหยื่อ2 : ลักษณะบาดเจ็บ',
    fieldEnglish: 'victim_2_injury_type',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...INJURY_TYPES],
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 42,
    fieldThai: 'เหยื่อ2 : มีความสัมพันธ์กับคู่กรณี',
    fieldEnglish: 'victim_2_relation_to_perpetrator',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...YES_NO],
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  // Victims 3
  {
    index: 43,
    fieldThai: 'เหยื่อ3 : ชื่อ - สกุล',
    fieldEnglish: 'victim_3_name',
    dataType: 'str',
    missing: 'Null',
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 44,
    fieldThai: 'เหยื่อ3 : เพศ',
    fieldEnglish: 'victim_3_gender',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...GENDERS],
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 45,
    fieldThai: 'เหยื่อ3 : อายุ',
    fieldEnglish: 'victim_3_age',
    dataType: 'int',
    missing: 'Null',
    notes: 'ปี · ไม่ทราบให้เว้นว่าง ห้ามใส่ 0',
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 46,
    fieldThai: 'เหยื่อ3 : อาชีพ',
    fieldEnglish: 'victim_3_occupation',
    dataType: 'str',
    missing: 'Null',
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 47,
    fieldThai: 'เหยื่อ3 : ลักษณะบาดเจ็บ',
    fieldEnglish: 'victim_3_injury_type',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...INJURY_TYPES],
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  {
    index: 48,
    fieldThai: 'เหยื่อ3 : มีความสัมพันธ์กับคู่กรณี',
    fieldEnglish: 'victim_3_relation_to_perpetrator',
    dataType: 'str',
    missing: 'Null',
    controlledVocab: [...YES_NO],
    category: 'victims',
    categoryThai: 'ข้อมูลเหยื่อ/ผู้เสียหาย',
  },
  // Summary
  {
    index: 49,
    fieldThai: 'สรุปข่าวโดยย่อ',
    fieldEnglish: 'news_summary',
    dataType: 'str',
    missing: 'Not Null',
    notes: 'สรุปพฤติการณ์เหตุการณ์โดยย่อ',
    category: 'summary',
    categoryThai: 'สรุปข่าว',
  },
];

export const CSV_HEADER_STRING =
  'id,news_type,url,news_agency,news_title,incident_date,incident_time,province,district,sub_district,incident_location,location_other,perpetrator_name,perpetrator_gender,perpetrator_age,perpetrator_occupation,perpetrator_occupation_detail,perpetrator_weapon,alcohol_test_method,alcohol_level,drinking_location,beverage_type,test_duration,recidivism,drug_use,drug_use_detail,total_affected,total_death,total_injury,public_property_damage,victim_1_name,victim_1_gender,victim_1_age,victim_1_occupation,victim_1_injury_type,victim_1_relation_to_perpetrator,victim_2_name,victim_2_gender,victim_2_age,victim_2_occupation,victim_2_injury_type,victim_2_relation_to_perpetrator,victim_3_name,victim_3_gender,victim_3_age,victim_3_occupation,victim_3_injury_type,victim_3_relation_to_perpetrator,news_summary';

export const CSV_HEADER_ARRAY = CSV_HEADER_STRING.split(',') as (keyof CrimeIncident)[];

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  warnings: string[];
}

export function validateIncident(data: Partial<CrimeIncident>): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  // 1. Not Null fields validation
  if (data.id === undefined || data.id === null || isNaN(Number(data.id))) {
    errors['id'] = 'ฟิลด์ "ลำดับ (id)" ต้องระบุค่าตัวเลขเสมอ (Not Null)';
  }

  if (!data.url || typeof data.url !== 'string' || data.url.trim() === '') {
    errors['url'] = 'ฟิลด์ "ลิงก์ (url)" ต้องระบุค่าเสมอ (Not Null)';
  }

  if (!data.news_agency || typeof data.news_agency !== 'string' || data.news_agency.trim() === '') {
    errors['news_agency'] = 'ฟิลด์ "สำนักข่าว (news_agency)" ต้องระบุค่าเสมอ (Not Null)';
  }

  if (!data.news_title || typeof data.news_title !== 'string' || data.news_title.trim() === '') {
    errors['news_title'] = 'ฟิลด์ "พาดหัวข่าว (news_title)" ต้องระบุค่าเสมอ (Not Null)';
  }

  if (!data.news_summary || typeof data.news_summary !== 'string' || data.news_summary.trim() === '') {
    errors['news_summary'] = 'ฟิลด์ "สรุปข่าวโดยย่อ (news_summary)" ต้องระบุค่าเสมอ (Not Null)';
  }

  // 2. Business Rule: Alcohol test method = 'สังเกตุอาการ' => alcohol_level must be null/empty
  if (data.alcohol_test_method === 'สังเกตุอาการ' && data.alcohol_level !== null && data.alcohol_level !== undefined && String(data.alcohol_level).trim() !== '') {
    errors['alcohol_level'] = 'เมื่อวิธีตรวจแอลกอฮอล์คือ "สังเกตุอาการ" ระดับแอลกอฮอล์ (alcohol_level) ต้องเว้นว่างเท่านั้น';
  }

  // 3. Business Rule: Age must not be 0
  if (data.perpetrator_age === 0) {
    errors['perpetrator_age'] = 'อายุผู้ก่อเหตุ: ไม่ทราบให้เว้นว่าง ห้ามใส่เลข 0 เด็ดขาด';
  }
  if (data.victim_1_age === 0) {
    errors['victim_1_age'] = 'อายุเหยื่อ 1: ไม่ทราบให้เว้นว่าง ห้ามใส่เลข 0 เด็ดขาด';
  }
  if (data.victim_2_age === 0) {
    errors['victim_2_age'] = 'อายุเหยื่อ 2: ไม่ทราบให้เว้นว่าง ห้ามใส่เลข 0 เด็ดขาด';
  }
  if (data.victim_3_age === 0) {
    errors['victim_3_age'] = 'อายุเหยื่อ 3: ไม่ทราบให้เว้นว่าง ห้ามใส่เลข 0 เด็ดขาด';
  }

  // 4. ตรวจ Controlled Vocabulary ให้ครบทุกฟิลด์ที่มีรายการกำหนดไว้
  //    (เดิมตรวจเพียง 4 ฟิลด์ ทำให้ค่าแปลกปลอมใน beverage_type / injury_type / test_method หลุดเข้าฐาน)
  const VOCAB_CHECKS: { field: keyof CrimeIncident; label: string; vocab: readonly string[] }[] = [
    { field: 'news_type', label: 'ประเภทข่าว', vocab: NEWS_TYPES },
    { field: 'incident_location', label: 'สถานที่เกิดเหตุ', vocab: INCIDENT_LOCATIONS },
    { field: 'perpetrator_gender', label: 'เพศผู้ก่อเหตุ', vocab: GENDERS },
    { field: 'perpetrator_occupation', label: 'ผู้ก่อเหตุประกอบอาชีพ', vocab: YES_NO },
    { field: 'perpetrator_weapon', label: 'อาวุธ', vocab: WEAPONS },
    { field: 'alcohol_test_method', label: 'วิธีตรวจแอลกอฮอล์', vocab: ALCOHOL_TEST_METHODS },
    { field: 'beverage_type', label: 'ประเภทเครื่องดื่ม', vocab: BEVERAGE_TYPES },
    { field: 'recidivism', label: 'กระทำความผิดซ้ำ', vocab: YES_NO },
    { field: 'drug_use', label: 'มีการใช้ยาเสพติด', vocab: YES_NO },
    { field: 'victim_1_gender', label: 'เหยื่อ 1 เพศ', vocab: GENDERS },
    { field: 'victim_1_injury_type', label: 'เหยื่อ 1 ลักษณะบาดเจ็บ', vocab: INJURY_TYPES },
    { field: 'victim_1_relation_to_perpetrator', label: 'เหยื่อ 1 สัมพันธ์กับคู่กรณี', vocab: YES_NO },
    { field: 'victim_2_gender', label: 'เหยื่อ 2 เพศ', vocab: GENDERS },
    { field: 'victim_2_injury_type', label: 'เหยื่อ 2 ลักษณะบาดเจ็บ', vocab: INJURY_TYPES },
    { field: 'victim_2_relation_to_perpetrator', label: 'เหยื่อ 2 สัมพันธ์กับคู่กรณี', vocab: YES_NO },
    { field: 'victim_3_gender', label: 'เหยื่อ 3 เพศ', vocab: GENDERS },
    { field: 'victim_3_injury_type', label: 'เหยื่อ 3 ลักษณะบาดเจ็บ', vocab: INJURY_TYPES },
    { field: 'victim_3_relation_to_perpetrator', label: 'เหยื่อ 3 สัมพันธ์กับคู่กรณี', vocab: YES_NO },
  ];

  for (const check of VOCAB_CHECKS) {
    const value = data[check.field];
    if (typeof value === 'string' && value !== '' && !check.vocab.includes(value)) {
      warnings.push(`${check.label} "${value}" ไม่อยู่ในรายการที่กำหนด`);
    }
  }

  // 5. ความสอดคล้องของจำนวนผู้ได้รับผลกระทบ
  const victimDeaths = [
    data.victim_1_injury_type,
    data.victim_2_injury_type,
    data.victim_3_injury_type,
  ].filter((t) => t === 'เสียชีวิต').length;

  if (typeof data.total_death === 'number' && victimDeaths > data.total_death) {
    warnings.push(
      `ระบุเหยื่อที่เสียชีวิต ${victimDeaths} ราย แต่ total_death = ${data.total_death}`
    );
  }

  if (
    typeof data.total_affected === 'number' &&
    typeof data.total_death === 'number' &&
    typeof data.total_injury === 'number' &&
    data.total_affected < data.total_death + data.total_injury
  ) {
    warnings.push(
      `จำนวนผู้ได้รับผลกระทบ (${data.total_affected}) น้อยกว่าผลรวมผู้เสียชีวิตและบาดเจ็บ (${data.total_death + data.total_injury})`
    );
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    warnings,
  };
}

export function createEmptyIncident(newId: number = 1): CrimeIncident {
  return {
    id: newId,
    news_type: '',
    url: '',
    news_agency: '',
    news_title: '',
    incident_date: new Date().toISOString().split('T')[0],
    incident_time: '12:00',
    province: '',
    district: '',
    sub_district: '',
    incident_location: '',
    location_other: '',
    perpetrator_name: '',
    perpetrator_gender: '',
    perpetrator_age: null,
    perpetrator_occupation: '',
    perpetrator_occupation_detail: '',
    perpetrator_weapon: '',
    alcohol_test_method: '',
    alcohol_level: null,
    drinking_location: '',
    beverage_type: '',
    test_duration: null,
    recidivism: '',
    drug_use: '',
    drug_use_detail: '',
    total_affected: 1,
    total_death: 0,
    total_injury: 0,
    public_property_damage: '',
    victim_1_name: '',
    victim_1_gender: '',
    victim_1_age: null,
    victim_1_occupation: '',
    victim_1_injury_type: '',
    victim_1_relation_to_perpetrator: '',
    victim_2_name: '',
    victim_2_gender: '',
    victim_2_age: null,
    victim_2_occupation: '',
    victim_2_injury_type: '',
    victim_2_relation_to_perpetrator: '',
    victim_3_name: '',
    victim_3_gender: '',
    victim_3_age: null,
    victim_3_occupation: '',
    victim_3_injury_type: '',
    victim_3_relation_to_perpetrator: '',
    news_summary: '',
  };
}
