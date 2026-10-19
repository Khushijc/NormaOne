import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { NoToken } from '../../components/Screen.jsx'
import { UserFilters, UserTable } from '../../components/UserParts.jsx'
import { userQuery } from '../../lib/forms.js'
import { Button, Card } from '../../components/ui/Kit.jsx'
import { detailPath } from '../../paths.js'

/**
 * Super admin › Users — READ ONLY. Regular users (role USER) across every organization;
 * administrators are on Administrators and Super Admins on neither.
 *
 * There is no create, edit or status control here because the backend has none: the Super Admin
 * views users and their organization's administrators manage them. A tenant's page links here with
 * ?tenantId= filled in.
 */
export default function Users() {
  const [params] = useSearchParams()
  const [filters, setFilters] = useState({ search: '', status: '', role: '', tenantId: params.get('tenantId') || '', page: 0 })
  const query = userQuery(filters)
  const read = useRead('sa-list-users', { query: { ...query, role: undefined }, label: 'List users' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="muted">{read.data ? `${read.data.totalElements} match · read only` : 'Regular users across every organization · read only'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>

      <Card>
        <UserFilters filters={filters} onChange={setFilters} withTenant withRole={false} />
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <span className="toolbar-spacer" />
          <EndpointTag id="sa-list-users" name="The list, as filtered" query={{ ...query, role: undefined }} />
        </div>
        <UserTable
          read={read}
          showTenant
          detailPath={(id) => detailPath('platform', 'users', 'users', id)}
          onPage={(page) => setFilters({ ...filters, page })}
        />
      </Card>
    </div>
  )
}
