import type { AuthzAPI } from '@syntara/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../client', () => ({
  authMiddleware: { onRequest: vi.fn() },
  interfaceTagMiddleware: { onRequest: vi.fn() },
}))

vi.mock('../../access/accessClient', () => ({
  accessFetchClient: {
    POST: vi.fn(),
  },
}))

import { accessFetchClient } from '../../access/accessClient'

import { useFormPromptSubmitUsers } from './useFormPromptSubmitUsers'

type WhoCanUser = AuthzAPI.components['schemas']['WhoCanUser']

const mockPOST = vi.mocked(accessFetchClient.POST)

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
    },
  })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('useFormPromptSubmitUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and returns users from authz/who_can endpoint', async () => {
    const mockUsers: WhoCanUser[] = [
      { id: 'user-1', username: 'alice' },
      { id: 'user-2', username: 'bob' },
    ]

    mockPOST.mockResolvedValue({
      data: { resources: mockUsers, next: null },
      error: undefined,
    })

    const { result } = renderHook(() => useFormPromptSubmitUsers('project-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.users).toEqual(mockUsers)
    expect(result.current.error).toBeNull()
  })

  it('scopes query to project when projectId provided', async () => {
    mockPOST.mockResolvedValue({
      data: { resources: [], next: null },
      error: undefined,
    })

    renderHook(() => useFormPromptSubmitUsers('project-123'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(mockPOST).toHaveBeenCalled()
    })

    expect(mockPOST).toHaveBeenCalledWith('/authz/who_can', {
      body: expect.objectContaining({
        action: 'submit',
        resource_type: 'form_prompt',
        resource_project: 'project-123',
        sort: 'username',
      }) as Record<string, unknown>,
    })
  })

  it('does not fetch when projectId is null', () => {
    const { result } = renderHook(() => useFormPromptSubmitUsers(null), {
      wrapper: createWrapper(),
    })

    expect(mockPOST).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.users).toEqual([])
  })

  it('sets isPermissionDenied when API returns AUTHORIZATION_DENIED', async () => {
    mockPOST.mockResolvedValue({
      data: undefined,
      error: { code: 'AUTHORIZATION_DENIED', title: 'Authorization Denied', detail: 'Not authorized' },
    })

    const { result } = renderHook(() => useFormPromptSubmitUsers('project-123'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isPermissionDenied).toBe(true)
    expect(result.current.users).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('fetches all pages when pagination is present', async () => {
    const page1Users: WhoCanUser[] = [{ id: 'user-1', username: 'alice' }]
    const page2Users: WhoCanUser[] = [{ id: 'user-2', username: 'bob' }]

    mockPOST
      .mockResolvedValueOnce({
        data: { resources: page1Users, next: 'cursor-1' },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { resources: page2Users, next: null },
        error: undefined,
      })

    const { result } = renderHook(() => useFormPromptSubmitUsers('project-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.users).toEqual([...page1Users, ...page2Users])
    expect(mockPOST).toHaveBeenCalledTimes(2)
  })

  it('does not retry on PermissionDeniedError', async () => {
    mockPOST.mockResolvedValue({
      data: undefined,
      error: { code: 'AUTHORIZATION_DENIED', title: 'Authorization Denied', detail: 'Not authorized' },
    })

    const retryEnabledClient = new QueryClient({
      defaultOptions: {
        queries: { retry: 3 },
      },
    })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: retryEnabledClient }, children)

    const { result } = renderHook(() => useFormPromptSubmitUsers('project-1'), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(mockPOST).toHaveBeenCalledTimes(1)
    expect(result.current.isPermissionDenied).toBe(true)
  })
})
