import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { ProjectsPage } from '../components/ProjectsPage.js'

afterEach(cleanup)

const mockLogout = vi.fn().mockResolvedValue(undefined)
const mockFetchProjects = vi.fn().mockResolvedValue(undefined)
const mockCreateProject = vi.fn()
const mockUpdateWorkspace = vi.fn().mockResolvedValue(undefined)

vi.mock('../stores/auth.store.js', () => ({
  useAuthStore: vi.fn(() => ({
    user: { id: 'u1', email: 'test@example.com' },
    accessToken: 'token123',
    logout: mockLogout,
  })),
}))

vi.mock('../stores/projects.store.js', () => ({
  useProjectsStore: vi.fn(() => ({
    projects: [],
    isLoading: false,
    fetchProjects: mockFetchProjects,
    createProject: mockCreateProject,
    updateWorkspace: mockUpdateWorkspace,
  })),
}))

const defaultProps = {
  serverUrl: 'http://localhost:3000',
  onSelectProject: vi.fn(),
  onLogout: vi.fn(),
}

describe('ProjectsPage', () => {
  it('사용자 이메일과 로그아웃 버튼 렌더링', () => {
    render(<ProjectsPage {...defaultProps} />)
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
    expect(screen.getByTestId('logout-button')).toBeInTheDocument()
  })

  it('프로젝트 없을 때 New Project 버튼 표시', () => {
    render(<ProjectsPage {...defaultProps} />)
    expect(screen.getByTestId('new-project-button')).toBeInTheDocument()
  })

  it('isLoading=true 이면 Loading 텍스트 표시', async () => {
    const { useProjectsStore } = await import('../stores/projects.store.js')
    vi.mocked(useProjectsStore).mockReturnValueOnce({
      projects: [],
      isLoading: true,
      fetchProjects: mockFetchProjects,
      createProject: mockCreateProject,
      updateWorkspace: mockUpdateWorkspace,
    })
    render(<ProjectsPage {...defaultProps} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('프로젝트 목록 렌더링 및 선택', async () => {
    const { useProjectsStore } = await import('../stores/projects.store.js')
    const onSelectProject = vi.fn()
    vi.mocked(useProjectsStore).mockReturnValueOnce({
      projects: [
        { id: 'p1', name: 'My App', slug: 'my-app', createdAt: new Date().toISOString(), workspace_path: '/home/user/app' },
      ],
      isLoading: false,
      fetchProjects: mockFetchProjects,
      createProject: mockCreateProject,
      updateWorkspace: mockUpdateWorkspace,
    })
    render(<ProjectsPage {...defaultProps} onSelectProject={onSelectProject} />)
    expect(screen.getByText('My App')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /my app/i }))
    expect(onSelectProject).toHaveBeenCalledWith('p1')
  })

  it('New Project 클릭 시 생성 폼 표시', () => {
    render(<ProjectsPage {...defaultProps} />)
    fireEvent.click(screen.getByTestId('new-project-button'))
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument()
  })

  it('생성 폼 제출 성공 시 onSelectProject 호출', async () => {
    const onSelectProject = vi.fn()
    mockCreateProject.mockResolvedValueOnce({ id: 'new-1', name: 'Test', slug: 'test', createdAt: new Date().toISOString() })
    render(<ProjectsPage {...defaultProps} onSelectProject={onSelectProject} />)
    fireEvent.click(screen.getByTestId('new-project-button'))
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Test Project' } })
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: /^create$/i }).closest('form')!)
    })
    expect(mockCreateProject).toHaveBeenCalled()
    expect(onSelectProject).toHaveBeenCalledWith('new-1')
  })

  it('생성 실패 시 오류 메시지 표시', async () => {
    mockCreateProject.mockRejectedValueOnce(new Error('Name taken'))
    render(<ProjectsPage {...defaultProps} />)
    fireEvent.click(screen.getByTestId('new-project-button'))
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bad Name' } })
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: /^create$/i }).closest('form')!)
    })
    expect(screen.getByText('Name taken')).toBeInTheDocument()
  })

  it('로그아웃 클릭 시 logout 및 onLogout 호출', async () => {
    const onLogout = vi.fn()
    render(<ProjectsPage {...defaultProps} onLogout={onLogout} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('logout-button'))
    })
    expect(mockLogout).toHaveBeenCalled()
    expect(onLogout).toHaveBeenCalled()
  })

  it('워크스페이스 없는 프로젝트에 + 워크스페이스 버튼 표시', async () => {
    const { useProjectsStore } = await import('../stores/projects.store.js')
    vi.mocked(useProjectsStore).mockReturnValueOnce({
      projects: [
        { id: 'p2', name: 'No WS', slug: 'no-ws', createdAt: new Date().toISOString(), workspace_path: null },
      ],
      isLoading: false,
      fetchProjects: mockFetchProjects,
      createProject: mockCreateProject,
      updateWorkspace: mockUpdateWorkspace,
    })
    render(<ProjectsPage {...defaultProps} />)
    expect(screen.getByText('워크스페이스 미설정')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+ 워크스페이스/i })).toBeInTheDocument()
  })
})
