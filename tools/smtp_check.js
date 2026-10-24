/* ============ QQ 邮箱 SMTP 诊断工具 ============
 * 用途：Supabase 发验证码报 "Error sending confirmation email" 时，
 * 在本地直连 smtp.qq.com 验证「邮箱 + 授权码」本身是否可用，隔离问题。
 *
 * 运行（在项目根目录）：
 *   node tools/smtp_check.js 你的QQ邮箱@qq.com 你的SMTP授权码
 *
 * 授权码只会留在你自己的终端里，不会写入任何文件。
 */
'use strict';
const nodemailer = require('nodemailer');

const [email, pass] = process.argv.slice(2);
if (!email || !pass) {
  console.log('用法: node tools/smtp_check.js <QQ邮箱> <SMTP授权码>');
  process.exit(1);
}

(async () => {
  console.log('1) 连接 smtp.qq.com:465 (SSL) …');
  const t = nodemailer.createTransport({
    host: 'smtp.qq.com', port: 465, secure: true,
    auth: { user: email, pass },
  });
  try {
    await t.verify();
    console.log('   ✅ 连接 + 认证成功（邮箱和授权码没问题）');
  } catch (e) {
    console.log('   ❌ 认证失败:', e.message);
    if (/auth/i.test(e.message)) {
      console.log('\n最常见原因：');
      console.log('  - Password 填了 QQ 登录密码，而不是「SMTP 授权码」');
      console.log('  - 授权码前后带了空格，或复制时多了字符');
      console.log('  - POP3/SMTP 服务没开启（QQ邮箱网页版→设置→账户→开启服务重新生成授权码）');
    }
    process.exit(1);
  }

  console.log('2) 发一封测试邮件给你自己 …');
  try {
    await t.sendMail({ from: `"旅行记忆" <${email}>`, to: email, subject: 'SMTP 测试 ✅', text: '如果你收到这封邮件，说明 QQ SMTP 完全正常，问题出在 Supabase 后台的填写项上。' });
    console.log('   ✅ 发送成功，请查收邮件（垃圾箱也看下）');
    console.log('\n=> QQ 邮箱本身没问题。请核对 Supabase 后台 SMTP Settings：');
    console.log('   - Enable Custom SMTP 开关是否打开');
    console.log('   - Host 必须是 smtp.qq.com（不是 smtp.gmail.com 等默认值）');
    console.log('   - Port = 465，Secure connection (SSL/TLS) 勾选');
    console.log('   - User = 完整邮箱地址；Pass = 授权码（重新粘贴一次，注意无空格）');
    console.log('   - Sender email 必须与 User 完全一致（QQ 不允许代发别的地址）');
    console.log('   - Sender name 随意，但不能为空');
    console.log('   改完后等 1-2 分钟，回网站重新发验证码。');
  } catch (e) {
    console.log('   ❌ 发送失败:', e.message);
    process.exit(1);
  }
})();
