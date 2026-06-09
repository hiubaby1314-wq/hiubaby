import React from 'react';
import { Activity, Users, Zap, Server } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext.tsx';

const Dashboard: React.FC = () => {
    const { t } = useLanguage();

    const stats = [
        { label: t('dashboard.calls'), value: '12,450', change: '+15.2%', icon: Activity, color: 'text-brand-500', bg: 'bg-brand-500/10' },
        { label: t('dashboard.users'), value: '3,280', change: '+8.1%', icon: Users, color: 'text-green-400', bg: 'bg-green-400/10' },
        { label: t('dashboard.latency'), value: '24%', change: '-2%', icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
        { label: t('dashboard.uptime'), value: '45.8%', change: '+1.2%', icon: Server, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">{t('dashboard.title')}</h1>
                <p className="text-gray-400">{t('dashboard.subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, index) => {
                    const Icon = stat.icon;
                    return (
                        <div key={index} className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stat.bg}`}>
                                    <Icon className={`w-6 h-6 ${stat.color}`} />
                                </div>
                                <span className={`text-sm font-medium ${stat.change.startsWith('+') ? 'text-green-400' : stat.change.startsWith('-') ? 'text-green-400' : 'text-gray-400'}`}>
                                    {stat.change}
                                </span>
                            </div>
                            <h3 className="text-gray-400 text-sm font-medium">{stat.label}</h3>
                            <p className="text-3xl font-bold text-white mt-1">{stat.value}</p>
                        </div>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 min-h-[300px] flex flex-col">
                    <h3 className="text-lg font-medium text-white mb-4">{t('dashboard.activity')}</h3>
                    <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl">
                        <p className="text-gray-500">{t('dashboard.chart.activity')}</p>
                    </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 min-h-[300px] flex flex-col">
                    <h3 className="text-lg font-medium text-white mb-4">{t('dashboard.distribution')}</h3>
                    <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl">
                        <p className="text-gray-500">{t('dashboard.chart.usage')}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;