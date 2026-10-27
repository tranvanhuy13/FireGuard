/* eslint-disable */
'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import {
  MessageCircle, Bell, Trash2, Edit2, Plus, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp, X, Eye, EyeOff, Save
} from 'lucide-react';
import { isMockData } from '@/lib/api/client';
import { API_URL } from '@/config';

type NotificationChannel = 'telegram' | 'zalo';

interface Account { id: string; channel: NotificationChannel; friendlyName: string; chatId: string; active: boolean; }
interface Rule { id: string; cameras: string[]; events: string[]; minConfidence: number; recipients: string[]; active: boolean; }
interface SystemConfig { telegramToken: string; zaloToken: string; webhookUrl: string; isConnected: boolean; }


const EmptyState = ({ message }: { message: string }) => (
  <div className="text-center py-12 border-2 border-dashed border-sky-100 rounded-xl bg-sky-50/30 flex flex-col items-center justify-center">
    <Bell className="w-12 h-12 text-sky-200 mb-3" />
    <p className="text-slate-500 font-medium">{message}</p>
  </div>
);

const AccountCard = ({ item, isGroup, n, hasRole, onToggle, onEdit, onDelete, maskChatId }: any) => {
  const [testState, setTestState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const handleTest = () => {
    setTestState('loading');
    setTimeout(() => { setTestState('success'); setTimeout(() => setTestState('idle'), 2000); }, 1000);
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${item.channel === 'telegram' ? 'bg-blue-100 text-blue-500' : 'bg-indigo-100 text-indigo-500'}`}><MessageCircle className="w-6 h-6" /></div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-800">{item.friendlyName}</h3>
            {item.channel === 'zalo' && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{n.apiConditionsApply}</span>}
          </div>
          <p className="text-sm text-slate-500 flex items-center gap-2 mt-1"><span className="capitalize">{item.channel}</span> &bull; {maskChatId(item.chatId)}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 self-end sm:self-auto">
        {hasRole(['admin', 'user']) && (
          <button onClick={() => onToggle(item)} className={`w-11 h-6 rounded-full relative transition-colors ${item.active ? 'bg-sky-500' : 'bg-slate-300'}`}>
            <motion.div className="w-4 h-4 bg-white rounded-full absolute top-1 shadow-sm" animate={{ left: item.active ? '24px' : '4px' }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
          </button>
        )}
        <Button variant="outline" size="sm" onClick={handleTest} disabled={testState !== 'idle' || !item.active || !hasRole(['admin', 'user'])} className={`px-3 py-1.5 text-sm ${testState === 'success' ? 'bg-emerald-500 hover:bg-emerald-600 text-white border-transparent' : testState === 'error' ? 'bg-red-500 hover:bg-red-600 text-white border-transparent' : ''}`}>
          {testState === 'loading' ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full" /> : testState === 'success' ? <CheckCircle2 className="w-4 h-4 text-white" /> : testState === 'error' ? <AlertCircle className="w-4 h-4 text-white" /> : n.test}
        </Button>
        {hasRole(['admin', 'user']) && (
          <>
            <button onClick={() => onEdit(item)} className="p-2 text-slate-400 hover:text-sky-600 transition-colors"><Edit2 className="w-4 h-4" /></button>
            <button onClick={() => onDelete(item)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
          </>
        )}
      </div>
    </div>
  );
};

const RuleCard = ({ rule, n, hasRole, onToggle, onEdit, onDelete }: any) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow">
    <div className="flex justify-between items-start mb-4">
      <div>
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          {rule.events?.includes('fire') && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs">🔥 {n.fire}</span>}
          {rule.events?.includes('smoke') && <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs">💨 {n.smoke}</span>}
        </h3>
        <p className="text-sm text-slate-500 mt-2">{n.cameras}: {rule.cameras?.includes('all') ? n.allCameras : rule.cameras?.join(', ')} &bull; {n.minConfidence}: {rule.minConfidence}%</p>
      </div>
      <div className="flex items-center gap-3">
        {hasRole(['admin', 'user']) && (
          <button onClick={() => onToggle(rule)} className={`w-11 h-6 rounded-full relative transition-colors ${rule.active ? 'bg-sky-500' : 'bg-slate-300'}`}>
            <motion.div className="w-4 h-4 bg-white rounded-full absolute top-1 shadow-sm" animate={{ left: rule.active ? '24px' : '4px' }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
          </button>
        )}
        {hasRole(['admin', 'user']) && (
          <>
            <button onClick={() => onEdit(rule)} className="p-2 text-slate-400 hover:text-sky-600 transition-colors"><Edit2 className="w-4 h-4" /></button>
            <button onClick={() => onDelete(rule)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
          </>
        )}
      </div>
    </div>
    {(!rule.recipients || rule.recipients.length === 0) && <div className="bg-amber-50 text-amber-700 p-3 rounded-lg text-sm flex items-center gap-2 mt-2"><AlertCircle className="w-4 h-4" />{n.warnNoRecipients}</div>}
    {rule.recipients && rule.recipients.length > 0 && <div className="mt-3 text-sm text-slate-600"><strong>{n.recipients}:</strong> {rule.recipients.length} selected</div>}
  </div>
);

const ModalWrapper = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => (
  <AnimatePresence>
    {isOpen && (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 flex items-center justify-center p-4" onClick={onClose}>
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden z-50 flex flex-col max-h-[90vh]">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X className="w-5 h-5"/></button>
          </div>
          <div className="p-6 overflow-y-auto">{children}</div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);


export default function NotificationsPage() {
  const { t } = useLanguage();
  const n = t.notifications;
  const { user, hasRole } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'accounts' | 'groups' | 'rules' | 'config'>('accounts');
  
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [groups, setGroups] = useState<Account[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [config, setConfig] = useState<SystemConfig>({ telegramToken: '', zaloToken: '', webhookUrl: '', isConnected: false });
  const [unsavedConfig, setUnsavedConfig] = useState(false);
  const [showToken, setShowToken] = useState({ telegram: false, zalo: false });

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ type: string; id: string } | null>(null);

  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editingGroup, setEditingGroup] = useState<Account | null>(null);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  const [channel, setChannel] = useState<NotificationChannel>('telegram');
  const [friendlyName, setFriendlyName] = useState('');
  const [chatId, setChatId] = useState('');
  const [formError, setFormError] = useState('');
  
  const [ruleCameras, setRuleCameras] = useState<string[]>(['all']);
  const [ruleEvents, setRuleEvents] = useState<string[]>(['fire', 'smoke']);
  const [ruleConfidence, setRuleConfidence] = useState(80);
  const [ruleRecipients, setRuleRecipients] = useState<string[]>([]);
  const [unsavedRule, setUnsavedRule] = useState(false);

  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    fetch('/notifications/accounts').then(r => r.json()).then(d => setAccounts(d.accounts || []));
    fetch('/notifications/groups').then(r => r.json()).then(d => setGroups(d.groups || []));
    fetch('/notifications/rules').then(r => r.json()).then(d => setRules(d.rules || []));
    if (hasRole(['admin', 'user'])) {
      fetch('/notifications/config').then(r => r.json()).then(d => {
        if (d) setConfig(d);
      });
    }
  }, [hasRole]);

  const resetForm = () => { setChannel('telegram'); setFriendlyName(''); setChatId(''); setFormError(''); setEditingAccount(null); setEditingGroup(null); };
  const resetRuleForm = () => { setRuleCameras(['all']); setRuleEvents(['fire', 'smoke']); setRuleConfidence(80); setRuleRecipients([]); setEditingRule(null); setUnsavedRule(false); };

  const maskChatId = (id: string) => { if (id.length <= 4) return id; return id.substring(0, 2) + '****' + id.substring(id.length - 2); };
  const maskToken = (token: string) => { if (token.length <= 8) return token; return token.substring(0, 4) + '*'.repeat(token.length - 8) + token.substring(token.length - 4); };

  const validateChatId = (id: string, isGroup: boolean) => {
    if (channel === 'telegram') return isGroup ? /^-?\d{5,20}$/.test(id) : /^-?\d{5,20}$/.test(id);
    return id.length > 5;
  };

  const handleSaveAccount = async (isGroup: boolean) => {
    if (!friendlyName || !chatId) { setFormError(n.error); return; }
    if (!validateChatId(chatId, isGroup)) { setFormError(n.chatIdPattern); return; }
    
    const currentList = isGroup ? groups : accounts;
    const editingItem = isGroup ? editingGroup : editingAccount;
    if (currentList.some(item => item.chatId === chatId && item.id !== editingItem?.id)) { setFormError(n.duplicateChatId); return; }

    const url = `/notifications/${isGroup ? 'groups' : 'accounts'}${editingItem ? `/${editingItem.id}` : ''}`;
    const method = editingItem ? 'PUT' : 'POST';
    const body = { channel, friendlyName, chatId, active: editingItem ? editingItem.active : true };
    
    const res = await fetch(url, { method, body: JSON.stringify(body) });
    if (res.ok) {
      const savedItem = await res.json();
      if (editingItem) {
        if (isGroup) setGroups(groups.map(g => g.id === savedItem.id ? savedItem : g));
        else setAccounts(accounts.map(a => a.id === savedItem.id ? savedItem : a));
      } else {
        if (isGroup) setGroups([...groups, savedItem]);
        else setAccounts([...accounts, savedItem]);
      }
      if (isGroup) setShowGroupModal(false); else setShowAccountModal(false);
      resetForm();
    }
  };

  const handleSaveRule = async () => {
    const url = `/notifications/rules${editingRule ? `/${editingRule.id}` : ''}`;
    const method = editingRule ? 'PUT' : 'POST';
    const body = { cameras: ruleCameras, events: ruleEvents, minConfidence: ruleConfidence, recipients: ruleRecipients, active: editingRule ? editingRule.active : true };
    
    const res = await fetch(url, { method, body: JSON.stringify(body) });
    if (res.ok) {
      const savedRule = await res.json();
      if (editingRule) setRules(rules.map(r => r.id === savedRule.id ? savedRule : r));
      else setRules([...rules, savedRule]);
      setShowRuleModal(false);
      resetRuleForm();
    }
  };

  const deleteItem = async () => {
    if (!showDeleteConfirm) return;
    const { type, id } = showDeleteConfirm;
    const res = await fetch(`/notifications/${type}s/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (type === 'account') setAccounts(accounts.filter(a => a.id !== id));
      if (type === 'group') setGroups(groups.filter(g => g.id !== id));
      if (type === 'rule') setRules(rules.filter(r => r.id !== id));
      setShowDeleteConfirm(null);
    }
  };

  const handleSaveConfig = async () => {
    const res = await fetch('/notifications/config', { method: 'PUT', body: JSON.stringify(config) });
    if (res.ok) setUnsavedConfig(false);
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col h-full bg-slate-50/30 p-4 pt-20 md:p-8 md:pt-24 rounded-3xl min-h-[calc(100vh-64px)]">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">{n.title}</h1>
        <p className="text-slate-500 mt-2">{n.subtitle}</p>
      </div>

      <div className="flex space-x-2 bg-white p-1.5 rounded-xl border border-slate-200 mb-8 w-fit shadow-sm flex-wrap gap-y-2">
        <button onClick={() => setActiveTab('accounts')} className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-all ${activeTab === 'accounts' ? 'bg-sky-50 text-sky-700 shadow-sm ring-1 ring-sky-100' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}>{n.tabAccounts}</button>
        <button onClick={() => setActiveTab('groups')} className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-all ${activeTab === 'groups' ? 'bg-sky-50 text-sky-700 shadow-sm ring-1 ring-sky-100' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}>{n.tabGroups}</button>
        <button onClick={() => setActiveTab('rules')} className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-all ${activeTab === 'rules' ? 'bg-sky-50 text-sky-700 shadow-sm ring-1 ring-sky-100' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}>{n.tabRules}</button>
        {hasRole(['admin']) && (
          <button onClick={() => setActiveTab('config')} className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-all ${activeTab === 'config' ? 'bg-sky-50 text-sky-700 shadow-sm ring-1 ring-sky-100' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}>{n.tabSystemConfig}</button>
        )}
      </div>

      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.15 }} className="p-6 md:p-8">
            {!isMockData && activeTab !== 'config' ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-800">
                <Bell className="w-12 h-12 text-amber-500 mx-auto mb-3" />
                <h2 className="text-lg font-bold mb-1">{t.auth.errors.featureNotImplemented}</h2>
                <p className="text-sm text-amber-700">Máy chủ chưa cung cấp API quản lý kênh nhận cảnh báo cá nhân (Telegram/Zalo).</p>
              </div>
            ) : (
              <>
            {activeTab === 'accounts' && (
              <div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                  <div><h2 className="text-xl font-bold text-slate-800">{n.accountsTitle}</h2><p className="text-slate-500 mt-1">{n.accountsDesc}</p></div>
                  {hasRole(['admin', 'user']) && (
                    <Button onClick={() => { resetForm(); setShowAccountModal(true); }} className="bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-sm px-5 py-2.5 flex items-center gap-2"><Plus className="w-4 h-4" /> {n.addAccount}</Button>
                  )}
                </div>
                {accounts.length === 0 ? <EmptyState message={n.noAccounts} /> : <div className="grid gap-4">{accounts.map(acc => <AccountCard key={acc.id} item={acc} isGroup={false} n={n} hasRole={hasRole} onToggle={async (item: any) => {
    const res = await fetch(`/notifications/accounts/${item.id}`, { method: 'PUT', body: JSON.stringify({ ...item, active: !item.active }) });
    if (res.ok) setAccounts(accounts.map((x: any) => x.id === item.id ? { ...x, active: !x.active } : x));
  }} onEdit={(item: any) => { setChannel(item.channel); setFriendlyName(item.friendlyName); setChatId(item.chatId); setEditingAccount(item); setShowAccountModal(true); }} onDelete={(item: any) => setShowDeleteConfirm({ type: 'account', id: item.id })} maskChatId={maskChatId} />)}</div>}
              </div>
            )}

            {activeTab === 'groups' && (
              <div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                  <div><h2 className="text-xl font-bold text-slate-800">{n.groupsTitle}</h2><p className="text-slate-500 mt-1">{n.groupsDesc}</p></div>
                  {hasRole(['admin', 'user']) && (
                    <Button onClick={() => { resetForm(); setShowGroupModal(true); }} className="bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-sm px-5 py-2.5 flex items-center gap-2"><Plus className="w-4 h-4" /> {n.createGroup}</Button>
                  )}
                </div>
                {groups.length === 0 ? <EmptyState message={n.noGroups} /> : <div className="grid gap-4">{groups.map(group => <AccountCard key={group.id} item={group} isGroup={true} n={n} hasRole={hasRole} onToggle={async (item: any) => {
    const res = await fetch(`/notifications/groups/${item.id}`, { method: 'PUT', body: JSON.stringify({ ...item, active: !item.active }) });
    if (res.ok) setGroups(groups.map((x: any) => x.id === item.id ? { ...x, active: !x.active } : x));
  }} onEdit={(item: any) => { setChannel(item.channel); setFriendlyName(item.friendlyName); setChatId(item.chatId); setEditingGroup(item); setShowGroupModal(true); }} onDelete={(item: any) => setShowDeleteConfirm({ type: 'group', id: item.id })} maskChatId={maskChatId} />)}</div>}
              </div>
            )}

            {activeTab === 'rules' && (
              <div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                  <div><h2 className="text-xl font-bold text-slate-800">{n.rulesTitle}</h2><p className="text-slate-500 mt-1">{n.rulesDesc}</p></div>
                  {hasRole(['admin', 'user']) && (
                    <Button onClick={() => { resetRuleForm(); setShowRuleModal(true); }} className="bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-sm px-5 py-2.5 flex items-center gap-2"><Plus className="w-4 h-4" /> {n.createRule}</Button>
                  )}
                </div>
                {rules.length === 0 ? <EmptyState message={n.noRules} /> : <div className="grid gap-4">{rules.map(rule => <RuleCard key={rule.id} rule={rule} n={n} hasRole={hasRole} onToggle={async (ruleItem: any) => {
    const res = await fetch(`/notifications/rules/${ruleItem.id}`, { method: 'PUT', body: JSON.stringify({ ...ruleItem, active: !ruleItem.active }) });
    if (res.ok) setRules(rules.map((x: any) => x.id === ruleItem.id ? { ...x, active: !x.active } : x));
  }} onEdit={(ruleItem: any) => { setEditingRule(ruleItem); setRuleCameras(ruleItem.cameras || []); setRuleEvents(ruleItem.events || []); setRuleConfidence(ruleItem.minConfidence || 80); setRuleRecipients(ruleItem.recipients || []); setUnsavedRule(false); setShowRuleModal(true); }} onDelete={(ruleItem: any) => setShowDeleteConfirm({ type: 'rule', id: ruleItem.id })} />)}</div>}
              </div>
            )}

            {activeTab === 'config' && hasRole(['admin']) && (
              <div className="max-w-2xl">
                <div className="mb-8">
                  <h2 className="text-xl font-bold text-slate-800">{n.systemConfigTitle}</h2>
                  <p className="text-slate-500 mt-1">{n.systemConfigDesc}</p>
                </div>
                
                {unsavedConfig && <div className="mb-6 p-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {n.unsavedWarning}</div>}
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{n.telegramToken}</label>
                    <div className="relative">
                      <input type={showToken.telegram ? "text" : "password"} value={config.telegramToken} onChange={e => { setConfig({...config, telegramToken: e.target.value}); setUnsavedConfig(true); }} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none pr-10" placeholder={n.telegramTokenPlaceholder} />
                      <button onClick={() => setShowToken({...showToken, telegram: !showToken.telegram})} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">{showToken.telegram ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{n.zaloToken}</label>
                    <div className="relative">
                      <input type={showToken.zalo ? "text" : "password"} value={config.zaloToken} onChange={e => { setConfig({...config, zaloToken: e.target.value}); setUnsavedConfig(true); }} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none pr-10" placeholder={n.zaloTokenPlaceholder} />
                      <button onClick={() => setShowToken({...showToken, zalo: !showToken.zalo})} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">{showToken.zalo ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{n.webhookUrl}</label>
                    <input type="text" value={config.webhookUrl} onChange={e => { setConfig({...config, webhookUrl: e.target.value}); setUnsavedConfig(true); }} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none" placeholder={n.webhookUrlPlaceholder} />
                  </div>
                  <div className="flex gap-4 pt-4 border-t border-slate-100">
                    <Button onClick={handleSaveConfig} disabled={!unsavedConfig} className="bg-sky-600 text-white hover:bg-sky-700 rounded-xl py-2.5 px-6 flex items-center gap-2"><Save className="w-4 h-4" /> {n.save}</Button>
                    <Button variant="outline" onClick={() => alert('Tested!')} className="bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl py-2.5 px-6">{n.testConnection}</Button>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'config' && !hasRole(['admin']) && (
              <div className="max-w-2xl">
                <div className="mb-8">
                  <h2 className="text-xl font-bold text-slate-800">{n.systemConfigTitle}</h2>
                  <p className="text-slate-500 mt-1">{n.userWarning}</p>
                </div>
                <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <span className="font-medium text-slate-700">{n.connectedStatus}:</span>
                  {config.isConnected ? <span className="text-emerald-600 font-semibold flex items-center gap-2"><CheckCircle2 className="w-5 h-5"/> {n.connectedStatus}</span> : <span className="text-slate-500">{n.disconnectedStatus}</span>}
                </div>
                {hasRole(['user']) && (
                  <Button variant="outline" className="mt-6 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl py-2.5 px-6">{n.sendTestAlert}</Button>
                )}
              </div>
            )}
            </>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {(() => {
        const renderAccountForm = (isGroup: boolean) => (
          <div className="space-y-5">
            {formError && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2"><AlertCircle className="w-4 h-4"/> {formError}</div>}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{n.channel}</label>
              <div className="flex gap-3">
                <label className={`flex-1 flex items-center justify-center gap-2 p-3 border rounded-xl cursor-pointer transition-all ${channel === 'telegram' ? 'border-sky-500 bg-sky-50 text-sky-700 ring-1 ring-sky-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  <input type="radio" className="sr-only" checked={channel === 'telegram'} onChange={() => setChannel('telegram')} /> Telegram
                </label>
                <label className={`flex-1 flex items-center justify-center gap-2 p-3 border rounded-xl cursor-pointer transition-all ${channel === 'zalo' ? 'border-sky-500 bg-sky-50 text-sky-700 ring-1 ring-sky-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  <input type="radio" className="sr-only" checked={channel === 'zalo'} onChange={() => setChannel('zalo')} /> Zalo
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{n.friendlyName}</label>
              <input type="text" value={friendlyName} onChange={e => setFriendlyName(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none transition-all" placeholder="e.g. John Doe" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{n.chatId}</label>
              <input type="text" value={chatId} onChange={e => setChatId(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none transition-all" placeholder={isGroup ? "-100123456789" : "123456789"} />
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <button onClick={() => setShowGuide(!showGuide)} className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-sm font-medium text-slate-700">
                {n.guideTitle}
                {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <AnimatePresence>
                {showGuide && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="p-4 text-sm text-slate-600 bg-white border-t border-slate-100">
                      {channel === 'telegram' ? (isGroup ? n.guideTelegramGroup : n.guideTelegramAccount) : (isGroup ? n.guideZaloGroup : n.guideZaloAccount)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="flex gap-3 pt-4 border-t border-slate-100 mt-6">
              <Button variant="outline" onClick={() => isGroup ? setShowGroupModal(false) : setShowAccountModal(false)} className="flex-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl py-2.5">{n.cancel}</Button>
              <Button onClick={() => handleSaveAccount(isGroup)} className="flex-1 bg-sky-600 text-white hover:bg-sky-700 rounded-xl py-2.5">{n.save}</Button>
            </div>
          </div>
        );

        return (
          <>
            <ModalWrapper isOpen={showAccountModal} onClose={() => setShowAccountModal(false)} title={editingAccount ? n.edit : n.addAccount}>{renderAccountForm(false)}</ModalWrapper>
            <ModalWrapper isOpen={showGroupModal} onClose={() => setShowGroupModal(false)} title={editingGroup ? n.edit : n.createGroup}>{renderAccountForm(true)}</ModalWrapper>
          </>
        );
      })()}

      <ModalWrapper isOpen={showRuleModal} onClose={() => setShowRuleModal(false)} title={editingRule ? n.edit : n.createRule}>
        <div className="space-y-6">
          {unsavedRule && <div className="p-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl flex items-center gap-2 text-sm"><AlertCircle className="w-4 h-4" /> {n.unsavedWarning}</div>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">{n.events}</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={ruleEvents.includes('fire')} onChange={e => { setRuleEvents(e.target.checked ? [...ruleEvents, 'fire'] : ruleEvents.filter(x => x !== 'fire')); setUnsavedRule(true); }} className="w-5 h-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs">🔥 {n.fire}</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={ruleEvents.includes('smoke')} onChange={e => { setRuleEvents(e.target.checked ? [...ruleEvents, 'smoke'] : ruleEvents.filter(x => x !== 'smoke')); setUnsavedRule(true); }} className="w-5 h-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs">💨 {n.smoke}</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3 flex justify-between">{n.minConfidence} <span className="text-sky-600 font-bold">{ruleConfidence}%</span></label>
            <input type="range" min="1" max="100" value={ruleConfidence} onChange={e => { setRuleConfidence(Number(e.target.value)); setUnsavedRule(true); }} className="w-full accent-sky-600" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">{n.recipients}</label>
            <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-1 bg-slate-50">
              {[...accounts, ...groups].length === 0 ? <div className="p-3 text-sm text-slate-500 text-center">{n.noAccounts} / {n.noGroups}</div> : [...accounts, ...groups].map(rec => (
                <label key={rec.id} className="flex items-center gap-3 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors">
                  <input type="checkbox" checked={ruleRecipients.includes(rec.id)} onChange={e => { setRuleRecipients(e.target.checked ? [...ruleRecipients, rec.id] : ruleRecipients.filter(x => x !== rec.id)); setUnsavedRule(true); }} className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                  <span className="text-sm font-medium text-slate-700">{rec.friendlyName}</span><span className="text-xs text-slate-400 capitalize">({rec.channel})</span>
                </label>
              ))}
            </div>
          </div>
          <div className="p-4 bg-slate-800 text-slate-100 rounded-xl font-mono text-xs overflow-hidden text-ellipsis whitespace-nowrap shadow-inner">{n.rulePreview}</div>
          <div className="flex gap-3 pt-4 border-t border-slate-100 mt-6">
            <Button variant="outline" onClick={() => setShowRuleModal(false)} className="flex-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl py-2.5">{n.cancel}</Button>
            <Button onClick={handleSaveRule} className="flex-1 bg-sky-600 text-white hover:bg-sky-700 rounded-xl py-2.5">{n.save}</Button>
          </div>
        </div>
      </ModalWrapper>

      <AnimatePresence>
        {showDeleteConfirm && (
          <ModalWrapper isOpen={!!showDeleteConfirm} onClose={() => setShowDeleteConfirm(null)} title={n.delete}>
            <div className="py-4">
              <p className="text-slate-600 text-center mb-6">{n.confirmDelete}</p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(null)} className="flex-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl py-2.5">{n.cancel}</Button>
                <Button onClick={deleteItem} className="flex-1 bg-red-600 text-white hover:bg-red-700 rounded-xl py-2.5">{n.delete}</Button>
              </div>
            </div>
          </ModalWrapper>
        )}
      </AnimatePresence>
    </div>
  );
}
