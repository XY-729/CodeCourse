# Fix Android Reader Bottom Chrome

## Spec

### Requirement: 沉浸模式下底部内容不被遮挡

- **When** `.android-reading-immersive` 生效(向下滚动时头部隐藏)
- **Then** 文档滚动到底时,最后一行完整可见,不被底部导航栏遮挡

### Requirement: 沉浸切换不引起滚动抽搐

- **When** 向下/向上滚动触发沉浸状态切换
- **Then** 滚动位置不发生可见回弹/振荡(滚动容器高度不因底部预留归零而突变)

### Requirement: 底部导航始终可见

- **When** 阅读文档(包括沉浸模式)
- **Then** 底部导航栏保持显示,可用

## Test Plan

1. 打开长文档 → 向下滑 → 头部隐藏,文档最后一行仍完整可见(不被底栏盖住)
2. 在底部附近反复上下滑动 → 无抽搐/回弹
3. 向上滑 → 头部恢复,一切正常
