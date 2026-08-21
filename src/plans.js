export const PLANS = [
  { id: 'p30_1', title: 'یک‌ماهه · ۳۰ گیگ', price: 295000, duration: '۱ ماه', volume: '۳۰ گیگ' },
  { id: 'p20_1', title: 'یک‌ماهه · ۲۰ گیگ', price: 195000, duration: '۱ ماه', volume: '۲۰ گیگ' },
  { id: 'p50_2', title: 'دوماهه · ۵۰ گیگ', price: 380000, duration: '۲ ماه', volume: '۵۰ گیگ' },
  { id: 'p30_2', title: 'دوماهه · ۳۰ گیگ', price: 240000, duration: '۲ ماه', volume: '۳۰ گیگ' }
];

export const findPlan = (id) => PLANS.find((plan) => plan.id === id);
export const toman = (amount) => new Intl.NumberFormat('fa-IR').format(amount) + ' تومان';
