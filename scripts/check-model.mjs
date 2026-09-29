import { analyzeWithModel, getModelStatus } from '../model.mjs';
try {
  const status=getModelStatus();
  console.log(`模型：${status.model}；配置：${status.configured?'已填写（尚未验证）':'缺少有效配置'}`);
  await analyzeWithModel({text:'请在周三前提交实习证明。',knowledge:'测试场景：校园服务窗口。'});
  console.log('连接成功：模型已返回可解析的回复和事项字段。此测试不验证实际手语或语音效果。');
} catch(error) {
  console.error(error.publicMessage || '连接测试失败，请检查配置。');
  process.exitCode=1;
}
