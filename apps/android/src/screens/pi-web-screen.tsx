import { useEffect, useRef, useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Check, FlaskConical, Menu, RefreshCw, Search, Server, ShieldAlert, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { PiWebCatalog, PiWebMessage } from '@dsh-remote/protocol'
import type { PiWebClientState, PiWebQuestionnaire, PiWebRemoteClient } from '@dsh-remote/client-core'
import { requirePiWeb, useAppStore } from '../state/store'
import { piWebAnswers, piWebMessageView, piWebQuestionnaireStatus, piWebQuestionnaireWrite, type PiWebDraft } from '../services/pi-web'
import { BlurHeaderFrame, Button, IconButton, TopBar } from '../ui/components'
import { KeyboardInset } from '../ui/keyboard-inset'
import { useResponsiveLayout } from '../ui/responsive'
import { spacing } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { ChatComposer } from './chat/composer'
import { MessageBubble, ToolRow, WelcomeMessage } from './chat/messages'
import { createStyles } from './chat/styles'
import { createHostSessionsDrawerStyles } from './host-sessions-drawer'

/** 独立 Pi Web 控制器复用原 App 展示组件，不接 ACP 会话／模型服务。 */
export function PiWebScreen({ onHosts, fixture }: { onHosts: () => void; fixture?: {
  client: PiWebRemoteClient; online: boolean; reconnect: () => Promise<boolean>; onControls?: () => void
} }) {
  const storedPhase = useAppStore(state => state.connection.phase)
  const storedDeviceId = useAppStore(state => state.selectedDevice?.deviceId)
  const storedReconnect = useAppStore(state => state.reconnect)
  const phase = fixture ? (fixture.online ? 'connected' : 'offline') : storedPhase
  const deviceId = fixture ? 'offline-fixture' : storedDeviceId
  const reconnect = fixture?.reconnect ?? storedReconnect
  const [client, setClient] = useState<PiWebRemoteClient>()
  const [state, setState] = useState<PiWebClientState>({ phase: 'idle', writes: [] })
  const [catalog, setCatalog] = useState<PiWebCatalog>()
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [composing, setComposing] = useState(false)
  const [older, setOlder] = useState<NonNullable<PiWebClientState['history']>>()
  const request = useRef(0)
  const view = useRef(0)
  const composerInputRef = useRef<TextInput>(null)
  const draftRef = useRef(draft)
  const styles = useThemedStyles(createStyles)
  const layout = useResponsiveLayout()
  const ref = state.snapshot
  const ready = phase === 'connected' && state.phase === 'ready'
  const report = () => setNotice('操作未完成；未自动重发，请检查状态或只读重同步。')
  const refresh = async (target: PiWebRemoteClient) => {
    const current = ++request.current
    try { const rows = await target.catalog(); if (current === request.current) setCatalog(rows) } catch { if (current === request.current) report() }
  }
  useEffect(() => {
    if (phase !== 'connected') return
    const active = fixture?.client ?? requirePiWeb()
    setClient(active)
    const off = active.onState(setState)
    void refresh(active)
    if (active.getState().snapshot) void active.resync().catch(report)
    return () => { ++request.current; ++view.current; off(); active.suspend() }
  }, [phase, deviceId, fixture?.client])
  useEffect(() => { ++view.current; setOlder(undefined); setDraft(''); draftRef.current = ''; setNotice('') }, [state.sessionId, ref?.agentInstanceId])
  useEffect(() => { setOlder(undefined) }, [state.history?.messages[0]?.messageId, state.history?.messages.at(-1)?.messageId])
  useEffect(() => { if (!ref?.running) setComposing(false) }, [ref?.running])
  const pick = async (row: NonNullable<typeof catalog>['sessions'][number]) => {
    if (!client || phase !== 'connected') return
    ++view.current; setOlder(undefined); setNotice(''); setDrawer(false)
    try {
      if (row.attachable && row.agentInstanceId) await client.attach(row.sessionId, row.agentInstanceId)
      else await client.browse(row.sessionId)
    } catch { report() }
  }
  const writes = state.writes.filter(w => w.ref.sessionId === ref?.sessionId && w.ref.agentInstanceId === ref?.agentInstanceId)
  const blockedPrompt = writes.some(w => w.kind === 'prompt' && ['submitting', 'unknown'].includes(w.verdict))
  const history = older ?? state.history
  const openDrawer = () => { Keyboard.dismiss(); setDrawer(true) }
  const title = catalog?.sessions.find(row => row.sessionId === state.sessionId)?.title ?? 'Pi Web'
  const readonly = state.phase === 'read-only'
  const header = <>
    <TopBar title={title} onBack={openDrawer} backIcon={Menu} backLabel="会话列表"
      subtitle={fixture ? '离线测试 · 无账号／模型' : undefined}
      action={<>
        {fixture?.onControls && <IconButton label="离线测试控制" icon={FlaskConical} dense onPress={fixture.onControls} />}
        <IconButton label="刷新目录" icon={RefreshCw} dense disabled={phase !== 'connected'} onPress={() => { if (client) void refresh(client) }} />
      </>} />
    {(phase !== 'connected' || !['ready', 'idle'].includes(state.phase) || notice) && <View style={styles.connectionBanner}>
      <View style={styles.connectionDot} />
      <Text accessibilityRole="alert" style={styles.connectionBannerText}>{notice || (readonly ? '冷会话只读，不创建或恢复 Agent' : `${phase} / ${state.phase} · 已暂停写入`)}</Text>
    </View>}
    {phase !== 'connected' && <Button label="重新连接（不重发写入）" variant="quiet" onPress={() => { void reconnect({ restoreSession: false }) }} />}
    {['resync-required', 'disconnected', 'replaced'].includes(state.phase) && <Button label="只读重同步" variant="quiet" disabled={phase !== 'connected' || state.phase === 'replaced'} onPress={() => { void client?.resync().catch(report) }} />}
  </>
  return <KeyboardInset>
    <View style={styles.flex}>
      <BlurHeaderFrame header={header}>{headerHeight => <ScrollView style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingTop: headerHeight + spacing.xl }, history?.messages.length ? styles.shortConversation : styles.emptyList]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {!state.sessionId && <><WelcomeMessage badge="Pi Web" /><Button label="选择已有会话" variant="quiet" onPress={openDrawer} /></>}
        {history?.hasMore && <Button label="查看更早历史（实时区保留）" variant="quiet" onPress={() => {
          if (!client || !state.sessionId) return
          const generation = view.current
          void client.readHistory(state.sessionId, history.before).then(page => { if (generation === view.current) setOlder(page) }).catch(report)
        }} />}
        {older && <Button label="回到当前聊天" variant="quiet" onPress={() => setOlder(undefined)} />}
        {history?.messages.map(entry => <Message key={entry.messageId} message={entry.message} id={entry.messageId} sessionId={state.sessionId!} />)}
        {ref?.streaming && <View><Text style={styles.pickerHint}>生成中（尚无持久消息 ID）</Text>
          <Message message={ref.streaming} id="local-live" sessionId={ref.sessionId} streaming /></View>}
        {ref?.tools?.map(tool => <Message key={tool.toolCallId} message={tool.partial ?? { role: 'toolResult', content: [], isError: false, truncated: false, toolName: tool.toolName }} id={tool.toolCallId} sessionId={ref.sessionId} streaming />)}
        {ref?.questionnaires.map(q => <Questionnaire key={`${ref.agentInstanceId}:${q.toolCallId}:${q.revision}`} q={q} state={state} client={client} enabled={ready} />)}
        {state.closedQuestionnaires?.map(q => <Questionnaire key={`${ref?.agentInstanceId}:${q.toolCallId}:${q.revision}`} q={q} state={state} client={client} enabled={ready} closed />)}
        {!!ref?.pendingUi?.length && <Text style={styles.pickerHint}>原扩展有未决对话。本页只对完整问卷提供原生填写，其他自定义交互暂为只读。</Text>}
        {writes.filter(w => !w.ref.toolCallId).map(w => <View key={w.operationId} style={styles.questionBlock}>
          <Text selectable style={styles.questionDetail}>{w.kind}: {w.verdict === 'unknown' ? '结果未知，不要重复发送' : w.verdict === 'accepted' ? '已受理（不代表任务完成）' : w.verdict === 'submitting' ? '提交中' : '已拒绝'} {w.code}</Text>
          {w.verdict === 'unknown' && <Button label="查询原操作回执" variant="secondary" disabled={!ready} onPress={() => { void client?.query(w.operationId).catch(report) }} />}
        </View>)}
      </ScrollView>}</BlurHeaderFrame>
      <View style={styles.composerWrap}><View style={styles.composerInner}>
        <ChatComposer backend="pi-web" draft={draft} input={{ composerInputRef, onChangeText: text => { draftRef.current = text; setDraft(text) } }}
          replyActive={ready && !!ref?.running} stopping={writes.some(w => w.kind === 'abort' && w.verdict === 'submitting')}
          compactRunning={ready && !!ref?.running && !draft && !composing} hasComposerContent={!!draft.trim()} connected={phase === 'connected'}
          composerDisabled={!ready || blockedPrompt} sendDisabled={!ready || !!ref?.running || blockedPrompt || !draft.trim()}
          compactComposer={layout.compactHeight} composerInputMaxHeight={140} model={{ available: false, label: undefined, selecting: false, onOpen: openDrawer }}
          promptsPickerOpen={false} onExpand={() => setComposing(true)} runningHint="处理中 · 可编辑草稿"
          replyStatus={ref?.questionnaires.some(q => q.state === 'open') ? '等待问卷答复' : '原实例处理中'}
          policyHint={readonly ? '只读历史 · 不启动 Agent' : '原 Pi Web 实例 · 忙碌时不排队 · 不自动重发'}
          onSubmit={() => {
            if (!client) return
            const text = draftRef.current; const generation = view.current
            void client.prompt(text).then(result => {
              if (result.verdict === 'accepted' && generation === view.current && draftRef.current === text) { draftRef.current = ''; setDraft('') }
            }).catch(report)
          }} onStop={() => { void client?.abort().catch(report) }} />
      </View></View>
    </View>
    {drawer && <SessionDrawer catalog={catalog} selected={state.sessionId} online={phase === 'connected'} onClose={() => setDrawer(false)} onHosts={onHosts} onPick={row => { void pick(row) }} />}
  </KeyboardInset>
}

function SessionDrawer({ catalog, selected, online, onClose, onHosts, onPick }: {
  catalog?: PiWebCatalog; selected?: string; online: boolean; onClose: () => void; onHosts: () => void
  onPick: (row: PiWebCatalog['sessions'][number]) => void
}) {
  const styles = useThemedStyles(createHostSessionsDrawerStyles)
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
  const rows = catalog?.sessions.filter(row => `${row.title} ${row.cwd}`.toLowerCase().includes(query.toLowerCase())) ?? []
  return <Modal animationType="slide" onRequestClose={onClose}>
    <View style={[styles.drawer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.brandHeader}><Text style={styles.brandTitle}>Pi Web Remote</Text><IconButton label="返回聊天" icon={X} onPress={onClose} /></View>
      <View style={styles.searchContainer}><Search size={18} color={colors.muted} /><TextInput accessibilityLabel="搜索会话" placeholder="搜索会话" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={styles.searchInput} /></View>
      <View style={styles.workspacesToolbar}><Text style={styles.workspacesTitle}>已有会话 · {rows.length}</Text></View>
      <ScrollView style={styles.sectionList} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.listContainer}>
        {rows.map((row, index) => <Pressable key={row.sessionId} accessibilityRole="button" accessibilityLabel={row.title} accessibilityState={{ selected: selected === row.sessionId, disabled: !online }} disabled={!online} onPress={() => { Keyboard.dismiss(); onPick(row) }}
          style={({ pressed }) => [styles.sessionRow, index === 0 && styles.sessionRowCardTop, index === rows.length - 1 && styles.sessionRowCardBottom, selected === row.sessionId && styles.sessionRowSelected, pressed && styles.pressedBg]}>
          <View style={styles.statusIndicatorSlot}>{row.running && <View style={styles.runningDot} />}</View>
          <Text style={[styles.sessionText, selected === row.sessionId && styles.sessionTextSelected]} numberOfLines={1}>{row.title}</Text>
          {!row.attachable && <Text style={styles.timeText}>只读</Text>}
        </Pressable>)}
        <Text style={[styles.workspacesTitle, { padding: spacing.lg }]}>只接入已有 Pi Web 会话；不提供模型配置、附件、创建或恢复会话。</Text>
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="切换主机" onPress={() => { onClose(); onHosts() }} style={styles.hostFooterBar}>
        <Server size={20} color={colors.ink} /><Text style={styles.hostFooterName}>Pi Web</Text><View style={[styles.hostFooterDot, { backgroundColor: online ? colors.success : colors.warning }]} /><Text style={styles.hostFooterStatusText}>{online ? '已连接' : '已断开'}</Text>
      </Pressable>
    </View>
  </Modal>
}

function Message({ message, id, sessionId, streaming = false }: { message: PiWebMessage; id: string; sessionId: string; streaming?: boolean }) {
  const item = piWebMessageView(message, sessionId, id, streaming)
  const styles = useThemedStyles(createStyles)
  return <View testID={`pi-web-${streaming ? 'transient' : 'entry'}-${id}`}>
    {item.kind === 'tool' ? <ToolRow item={item} compact={false} /> : <MessageBubble item={item} compact={false} />}
    {message.truncated && <Text style={styles.pickerHint}>内容已截断</Text>}
  </View>
}

function Questionnaire({ q, state, client, enabled, closed = false }: { q: PiWebQuestionnaire; state: PiWebClientState; client?: PiWebRemoteClient; enabled: boolean; closed?: boolean }) {
  const [drafts, setDrafts] = useState<Record<number, PiWebDraft>>({})
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const write = piWebQuestionnaireWrite(state, q)
  const locked = closed || !enabled || q.state !== 'open' || !!write && ['submitting', 'unknown', 'accepted', 'already-closed', 'stale'].includes(write.verdict)
  const terminal = closed || q.state !== 'open' || write?.verdict === 'accepted' || write?.verdict === 'already-closed'
  const update = (index: number, patch: Partial<PiWebDraft>) => setDrafts(current => ({ ...current, [index]: { options: [], text: '', notes: '', ...current[index], ...patch } }))
  const failure = () => setError('未完成，请检查权威状态；未自动重发。')
  return <View style={styles.questionCard} accessibilityRole="alert">
    <View style={styles.permissionHeader}>
      <View style={styles.permissionIcon}><ShieldAlert size={20} color={colors.accent} /></View>
      <View style={styles.permissionHeaderCopy}><Text style={styles.permissionTitle}>完整问卷</Text><Text style={styles.permissionKind}>{piWebQuestionnaireStatus(q, write, closed)}</Text></View>
    </View>
    <Text selectable style={styles.questionDetail}>{q.toolCallId}</Text>
    {error !== '' && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
    {!terminal && <>
      {q.questions?.map(question => {
        const index = question.questionIndex
        const draft = drafts[index] ?? { options: [], text: '', notes: '' }
        return <View key={index} style={styles.questionBlock}>
          <Text style={styles.questionText}>{question.header} · {question.multiSelect ? '多选' : '单选'}{'\n'}{question.question}</Text>
          {question.options.map(option => {
            const chosen = draft.options.includes(option.optionIndex)
            return <Pressable key={option.optionIndex} accessibilityLabel={`${question.header} 选项 ${option.optionIndex + 1} ${option.label}`} accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'} accessibilityState={{ checked: chosen, disabled: locked }} disabled={locked} style={[styles.optionRow, chosen && styles.optionChosen]} onPress={() => {
              update(index, { options: question.multiSelect ? (chosen ? draft.options.filter(i => i !== option.optionIndex) : [...draft.options, option.optionIndex]) : (chosen ? [] : [option.optionIndex]), ...(!question.multiSelect ? { text: '' } : {}) })
            }}>
              <View style={[styles.optionDot, chosen && styles.optionDotChosen]}>{chosen && <Check size={12} color={colors.white} />}</View>
              <View style={{ flex: 1 }}><Text style={styles.optionLabel}>{option.label}</Text><Text style={styles.optionDescription}>{option.description}</Text>
                {option.preview && <Text selectable style={styles.toolDetailCode}>{option.preview}</Text>}</View>
            </Pressable>
          })}
          <TextInput accessibilityLabel={`${question.header} 自由输入`} placeholder="自由输入" placeholderTextColor={colors.muted} multiline editable={!locked} value={draft.text} onChangeText={text => update(index, { text, ...(!question.multiSelect && text ? { options: [] } : {}) })} style={styles.questionCustom} />
          <TextInput accessibilityLabel={`${question.header} 备注`} placeholder="题目备注（可选）" placeholderTextColor={colors.muted} editable={!locked} value={draft.notes} onChangeText={notes => update(index, { notes })} style={styles.questionCustom} />
        </View>
      })}
      <TextInput accessibilityLabel="整份问卷备注" placeholder="整份备注（可选）" placeholderTextColor={colors.muted} editable={!locked} value={note} onChangeText={setNote} style={styles.questionCustom} />
      <Button label="整份提交" disabled={locked} onPress={() => { setError(''); void client?.submit(q, piWebAnswers(q, drafts), note).catch(failure) }} />
      <Button label="取消整份问卷" variant="quiet" disabled={locked} onPress={() => { setError(''); void client?.cancel(q, note).catch(failure) }} />
    </>}
    {write?.verdict === 'unknown' && <Button label="查询回执" variant="secondary" disabled={!enabled} onPress={() => { void client?.query(write.operationId).catch(failure) }} />}
  </View>
}
