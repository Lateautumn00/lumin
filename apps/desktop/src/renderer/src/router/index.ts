import type { Component } from 'vue'
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { toolManifests } from '../../../tool-manifests'
import AboutView from '../layout/AboutView.vue'
import AppShell from '../layout/AppShell.vue'
import SettingsView from '../layout/SettingsView.vue'

const toolViews = import.meta.glob<{ default: Component }>('../tools/*.vue')

const toolRoutes: RouteRecordRaw[] = toolManifests.map((manifest) => {
  const loader = toolViews[`../tools/${manifest.id}.vue`]
  if (!loader) throw new Error(`工具页面缺失：${manifest.id}`)
  return {
    path: `tools/${manifest.id}`,
    component: async () => (await loader()).default
  }
})

const firstTool = toolManifests[0]
const firstToolPath = firstTool !== undefined ? `/tools/${firstTool.id}` : '/settings'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: AppShell,
      children: [
        { path: '', redirect: firstToolPath },
        ...toolRoutes,
        { path: 'settings', component: SettingsView },
        { path: 'about', component: AboutView }
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: firstToolPath }
  ]
})
