// 飞书通知使用同一份双语资源；缺少或无效语言时回退英文。
export const catalogs = {
  en: {
    titleSuccess: 'ReadmeX · iOS build successful', titleFailure: 'ReadmeX · iOS build failed', titleCancelled: 'ReadmeX · iOS build cancelled',
    platform: 'Platform', version: 'Version', build: 'Build number', source: 'Source', ipa: 'IPA artifact', logs: 'Actions logs', testflight: 'TestFlight',
    uploaded: 'Upload accepted by Apple', failed: 'Upload failed', skipped: 'Not requested', blocked: 'Not uploaded',
    processing: 'Apple processing', pending: 'Pending', valid: 'Ready', invalid: 'Invalid', connectivity: 'ReadmeX · webhook connection verified',
  },
  zh: {
    titleSuccess: 'ReadmeX · iOS 打包成功', titleFailure: 'ReadmeX · iOS 打包失败', titleCancelled: 'ReadmeX · iOS 打包已取消',
    platform: '平台', version: '版本', build: '构建号', source: '源码', ipa: 'IPA 产物', logs: 'Actions 日志', testflight: 'TestFlight',
    uploaded: 'Apple 已接受上传', failed: '上传失败', skipped: '未请求上传', blocked: '未上传',
    processing: 'Apple 处理状态', pending: '等待处理', valid: '可测试', invalid: '无效', connectivity: 'ReadmeX · Webhook 连通验证成功',
  },
};

export function releaseCopy(lang) { return catalogs[lang] ?? catalogs.en; }
