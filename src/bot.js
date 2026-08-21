import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { initDb, createOrder, getOrder, setReceipt, reviewOrder, markDelivered } from './db.js';
import { PLANS, findPlan, toman } from './plans.js';

const required = ['BOT_TOKEN', 'ADMIN_ID', 'DATABASE_URL', 'CARD_NUMBER', 'CARD_HOLDER'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);

const adminId = Number(process.env.ADMIN_ID);
const bot = new Telegraf(process.env.BOT_TOKEN);
const awaitingReceipt = new Map();

const planKeyboard = () => Markup.inlineKeyboard(
  PLANS.map((p) => [Markup.button.callback(`${p.title} — ${toman(p.price)}`, `plan:${p.id}`)])
);

const isAdmin = (ctx) => ctx.from?.id === adminId;
const orderText = (order, plan) => `سفارش #${order.id}\nپلن: ${plan.title}\nحجم: ${plan.volume}\nمدت: ${plan.duration}\nمبلغ: ${toman(plan.price)}`;

bot.start(async (ctx) => {
  await ctx.reply('سلام 👋\nبرای خرید اشتراک، پلن موردنظر را انتخاب کنید.', planKeyboard());
});

bot.command('plans', async (ctx) => ctx.reply('پلن‌های فعال:', planKeyboard()));
bot.command('support', async (ctx) => ctx.reply(`پشتیبانی: ${process.env.SUPPORT_USERNAME || 'با مدیر تماس بگیرید.'}`));

bot.action(/^plan:(.+)$/, async (ctx) => {
  const plan = findPlan(ctx.match[1]);
  if (!plan) return ctx.answerCbQuery('پلن معتبر نیست.');
  const order = await createOrder({
    telegramId: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    planId: plan.id
  });
  awaitingReceipt.set(ctx.from.id, order.id);
  await ctx.answerCbQuery();
  await ctx.reply(
    `${orderText(order, plan)}\n\nمبلغ را به کارت زیر واریز کنید:\n\`${process.env.CARD_NUMBER}\`\nبه نام: ${process.env.CARD_HOLDER}\n\nسپس تصویر یا فایل رسید را همین‌جا ارسال کنید.`,
    { parse_mode: 'Markdown' }
  );
});

async function acceptReceipt(ctx, fileId, type) {
  const orderId = awaitingReceipt.get(ctx.from.id);
  if (!orderId) return ctx.reply('ابتدا یک پلن را از /plans انتخاب کنید.');
  const order = await setReceipt(orderId, fileId, type);
  awaitingReceipt.delete(ctx.from.id);
  if (!order) return ctx.reply('این سفارش دیگر برای دریافت رسید فعال نیست.');
  const plan = findPlan(order.plan_id);
  const user = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'بدون نام کاربری');
  const caption = `رسید جدید برای ${orderText(order, plan)}\nکاربر: ${user}\nشناسه: ${order.telegram_id}`;
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('✅ تأیید پرداخت', `approve:${order.id}`), Markup.button.callback('❌ رد پرداخت', `reject:${order.id}`)],
    [Markup.button.callback('📦 تحویل اشتراک', `deliver:${order.id}`)]
  ]);
  if (type === 'photo') await bot.telegram.sendPhoto(adminId, fileId, { caption, ...buttons });
  else await bot.telegram.sendDocument(adminId, fileId, { caption, ...buttons });
  await ctx.reply('رسید دریافت شد و برای بررسی مدیر ارسال شد. پس از تأیید، اشتراک برایتان فرستاده می‌شود.');
}

bot.on('photo', (ctx) => acceptReceipt(ctx, ctx.message.photo.at(-1).file_id, 'photo'));
bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(doc.mime_type)) return ctx.reply('فقط تصویر JPG/PNG یا فایل PDF رسید را ارسال کنید.');
  if (doc.file_size > 10 * 1024 * 1024) return ctx.reply('حجم فایل رسید باید کمتر از ۱۰ مگابایت باشد.');
  return acceptReceipt(ctx, doc.file_id, 'document');
});

bot.action(/^(approve|reject):(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید.', { show_alert: true });
  const status = ctx.match[1] === 'approve' ? 'approved' : 'rejected';
  const order = await reviewOrder(Number(ctx.match[2]), status);
  if (!order) return ctx.answerCbQuery('سفارش قبلاً بررسی شده یا وجود ندارد.');
  await ctx.answerCbQuery(status === 'approved' ? 'پرداخت تأیید شد.' : 'پرداخت رد شد.');
  await ctx.editMessageReplyMarkup(undefined);
  await bot.telegram.sendMessage(order.telegram_id, status === 'approved'
    ? `پرداخت سفارش #${order.id} تأیید شد ✅\nمدیر به‌زودی اشتراک را از طریق همین ربات ارسال می‌کند.`
    : `پرداخت سفارش #${order.id} تأیید نشد ❌\nبرای پیگیری از /support استفاده کنید.`);
});

bot.action(/^deliver:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید.', { show_alert: true });
  const order = await getOrder(Number(ctx.match[1]));
  if (!order || order.status !== 'approved') return ctx.answerCbQuery('ابتدا باید پرداخت تأیید شود.', { show_alert: true });
  await ctx.answerCbQuery();
  awaitingReceipt.set(adminId, `deliver:${order.id}`);
  await ctx.reply('متن یا فایل اشتراک را در پیام بعدی ارسال کنید؛ همان محتوا برای خریدار فرستاده می‌شود.');
});

bot.on('text', async (ctx, next) => {
  const delivery = awaitingReceipt.get(ctx.from.id);
  if (isAdmin(ctx) && typeof delivery === 'string' && delivery.startsWith('deliver:')) {
    const id = Number(delivery.split(':')[1]);
    const order = await getOrder(id);
    await bot.telegram.sendMessage(order.telegram_id, `اشتراک سفارش #${id} ✅\n\n${ctx.message.text}`);
    await markDelivered(id);
    awaitingReceipt.delete(adminId);
    return ctx.reply(`اشتراک سفارش #${id} برای کاربر ارسال شد.`);
  }
  return next();
});

bot.catch((error, ctx) => console.error(`Update ${ctx.update.update_id} failed`, error));
await initDb();
await bot.launch({ dropPendingUpdates: false });
console.log('Bot is running');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
