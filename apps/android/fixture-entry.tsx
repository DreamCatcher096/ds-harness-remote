// 仅由工作树外的独立测试构建选择；正常 App 的 package.json/main 不引用它。
import './src/polyfills'
import { registerRootComponent } from 'expo'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { BackHandler, Keyboard, Modal, ScrollView, Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ThemeProvider, useTheme } from './src/ui/theme-context'
import { Button, Screen, TopBar } from './src/ui/components'
import { PiWebScreen } from './src/screens/pi-web-screen'
import { PiWebFixtureRpc } from './src/fixtures/pi-web-rpc'
import { applyLanguagePreference } from './src/locales/i18n'

// 只固定此夹具的展示语言，不读取或修改原 App 的语言设置。
applyLanguagePreference('zh-CN')

function FixtureScreen() {
  const [driver] = useState(() => new PiWebFixtureRpc())
  const [online, setOnline] = useState(true)
  const [visible, setVisible] = useState(true)
  const [controls, setControls] = useState(false)
  const [revision, setRevision] = useState(0)
  const { colors, scheme } = useTheme()
  const refresh = () => setRevision(v => v + 1)
  useEffect(() => {
    const off = driver.client.onState(refresh)
    const back = BackHandler.addEventListener('hardwareBackPress', () => { if (!visible) return false; setVisible(false); return true })
    return () => { off(); back.remove() }
  }, [driver, visible])
  useEffect(() => () => driver.close(), [driver])
  const reconnect = async () => { driver.reconnect(); setOnline(true); refresh(); return true }
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    {visible ? <PiWebScreen onHosts={() => setVisible(false)} fixture={{ client: driver.client, online, reconnect, onControls: () => { Keyboard.dismiss(); setControls(true) } }} />
      : <Screen><Text style={{ color: colors.ink }}>已离开视图，没有取消问卷或任务。</Text><Button label="返回原生链路" onPress={() => setVisible(true)} /></Screen>}
    <Modal visible={controls} animationType="slide" onRequestClose={() => setControls(false)}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <TopBar title="离线夹具控制" onBack={() => setControls(false)} backLabel="关闭测试控制" />
        <Screen><ScrollView contentContainerStyle={{ gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: colors.ink }}>禁止联网 · 无账号／模型 · 非真实 Host 验收</Text>
          <Text testID="fixture-counts" style={{ color: colors.ink }}>发送={driver.counts.prompts} 停止={driver.counts.stops} 提交={driver.counts.submits} 取消={driver.counts.cancels} 其他端={driver.counts.other}</Text>
          <Text style={{ color: colors.ink }}>{driver.answerSummary || '请选择“活动夹具”，所有操作只进入内存假 RPC。'}</Text>
          <Button label="打开问卷" onPress={() => { driver.openQuestionnaire(); refresh(); setControls(false) }} />
          <Button label="另一端完成" onPress={() => { driver.finishElsewhere(); refresh(); setControls(false) }} />
          <Button label={driver.dropNextReceipt ? '已设丢回执' : '丢下次回执'} onPress={() => { driver.dropNextReceipt = true; refresh(); setControls(false) }} />
          <Button label="断开夹具" disabled={!online} onPress={() => { driver.disconnect(); setOnline(false); refresh(); setControls(false) }} />
          <Button label="重连夹具" disabled={online} onPress={() => { void reconnect(); setControls(false) }} />
          <Button label="替换实例" onPress={() => { driver.replaceInstance(); refresh(); setControls(false) }} />
          <Button label="制造序列缺口" onPress={() => { driver.gap(); refresh(); setControls(false) }} />
          <Text style={{ color: colors.muted }}>状态版本 {revision} · 独立测试 APK · 不保存真实对话</Text>
        </ScrollView></Screen>
      </View>
    </Modal>
  </View>
}
function FixtureApp() { return <SafeAreaProvider><ThemeProvider><FixtureScreen /></ThemeProvider></SafeAreaProvider> }
registerRootComponent(FixtureApp)
