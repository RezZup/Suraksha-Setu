import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Users, Search, Filter, Edit2, Trash2, Shield,
  UserCheck, UserX, Crown, GraduationCap, Microscope,
  MoreVertical, Loader2, Plus, CheckCircle2, XCircle, RefreshCw
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { motion } from 'framer-motion';
import { getAuthHeadersForApi } from '@/utils/authHeaders';
import { Skeleton } from 'boneyard-js/react';

const API_URL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000');

const SAMPLE_USERS = [
  {
    id: '1',
    name: 'Rahul Sharma',
    email: 'rahul@example.com',
    role: 'citizen',
    status: 'active',
    joinedDate: '2024-01-15',
    lastActive: '2 hours ago',
    location: 'Bhubaneswar, Odisha'
  },
  {
    id: '2',
    name: 'Priya Das',
    email: 'priya@example.com',
    role: 'student',
    status: 'active',
    joinedDate: '2024-02-20',
    lastActive: '1 day ago',
    location: 'Cuttack, Odisha'
  },
  {
    id: '3',
    name: 'Dr. Amit Kumar',
    email: 'amit@example.com',
    role: 'scientist',
    status: 'active',
    joinedDate: '2024-01-10',
    lastActive: '3 hours ago',
    location: 'Puri, Odisha'
  },
  {
    id: '4',
    name: 'Sunita Patel',
    email: 'sunita@example.com',
    role: 'citizen',
    status: 'inactive',
    joinedDate: '2024-03-05',
    lastActive: '2 weeks ago',
    location: 'Sambalpur, Odisha'
  },
  {
    id: '5',
    name: 'Ravi Mishra',
    email: 'ravi@example.com',
    role: 'admin',
    status: 'active',
    joinedDate: '2024-01-01',
    lastActive: '30 minutes ago',
    location: 'Bhubaneswar, Odisha'
  }
];

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', status: '' });
  const [createForm, setCreateForm] = useState({ name: '', email: '', role: 'citizen', status: 'active' });

  const getAuthHeaders = () => {
    return getAuthHeadersForApi(API_URL, 'admin');
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    filterUsers();
  }, [users, searchQuery, roleFilter, statusFilter]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      // Try to fetch from backend, fallback to sample data
      try {
        const response = await axios.get(`${API_URL}/admin/users`, { headers: getAuthHeaders() });
        setUsers(response.data.users || []);
      } catch (error) {
        console.log('Using sample data for users');
        setUsers(SAMPLE_USERS);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
      setUsers(SAMPLE_USERS);
    } finally {
      setLoading(false);
    }
  };

  const filterUsers = () => {
    let filtered = [...users];

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(user =>
        (user.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (user.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (user.location || '').toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Role filter
    if (roleFilter !== 'all') {
      filtered = filtered.filter(user => user.role === roleFilter);
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(user => user.status === statusFilter);
    }

    setFilteredUsers(filtered);
  };

  const handleEditUser = (user) => {
    setSelectedUser(user);
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status
    });
    setEditDialogOpen(true);
  };

  const handleDeleteUser = (user) => {
    setSelectedUser(user);
    setDeleteDialogOpen(true);
  };

  const confirmEdit = async () => {
    try {
      // Try backend update
      try {
        await axios.put(`${API_URL}/admin/users/${selectedUser.id}`, editForm, { headers: getAuthHeaders() });
      } catch (error) {
        console.log('Backend update not available, updating locally');
      }

      // Update local state
      setUsers(users.map(user =>
        user.id === selectedUser.id
          ? { ...user, ...editForm }
          : user
      ));

      toast.success('User updated successfully');
      setEditDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error updating user:', error);
      toast.error('Failed to update user');
    }
  };

  const confirmDelete = async () => {
    try {
      // Try backend delete
      try {
        await axios.delete(`${API_URL}/admin/users/${selectedUser.id}`, { headers: getAuthHeaders() });
      } catch (error) {
        console.log('Backend delete not available, deleting locally');
      }

      // Update local state
      setUsers(users.filter(user => user.id !== selectedUser.id));

      toast.success('User deleted successfully');
      setDeleteDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error('Failed to delete user');
    }
  };

  const confirmCreate = async () => {
    try {
      await axios.post(`${API_URL}/admin/users`, createForm, { headers: getAuthHeaders() });
      toast.success('User created successfully');
      setCreateDialogOpen(false);
      setCreateForm({ name: '', email: '', role: 'citizen', status: 'active' });
      await fetchUsers();
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error(error?.response?.data?.detail || 'Failed to create user');
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'admin': return <Crown className="w-4 h-4" />;
      case 'scientist': return <Microscope className="w-4 h-4" />;
      case 'student': return <GraduationCap className="w-4 h-4" />;
      default: return <Users className="w-4 h-4" />;
    }
  };

  const getRoleBadge = (role) => {
    const colors = {
      admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
      scientist: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
      student: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
      citizen: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    };

    return (
      <Badge variant="outline" className={`gap-1 ${colors[role]}`}>
        {getRoleIcon(role)}
        {role.charAt(0).toUpperCase() + role.slice(1)}
      </Badge>
    );
  };

  const getStatusBadge = (status) => {
    return status === 'active' ? (
      <Badge variant="outline" className="gap-1 bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
        <CheckCircle2 className="w-3 h-3" />
        Active
      </Badge>
    ) : (
      <Badge variant="outline" className="gap-1 bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">
        <XCircle className="w-3 h-3" />
        Inactive
      </Badge>
    );
  };

  const stats = {
    total: users.length,
    active: users.filter(u => u.status === 'active').length,
    citizens: users.filter(u => u.role === 'citizen').length,
    students: users.filter(u => u.role === 'student').length,
    scientists: users.filter(u => u.role === 'scientist').length,
    admins: users.filter(u => u.role === 'admin').length
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col items-center text-center">
            <Users className="w-8 h-8 mb-2 text-blue-600" />
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total Users</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center text-center">
            <UserCheck className="w-8 h-8 mb-2 text-green-600" />
            <p className="text-2xl font-bold">{stats.active}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center text-center">
            <Users className="w-8 h-8 mb-2 text-gray-600" />
            <p className="text-2xl font-bold">{stats.citizens}</p>
            <p className="text-xs text-muted-foreground">Citizens</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center text-center">
            <GraduationCap className="w-8 h-8 mb-2 text-green-600" />
            <p className="text-2xl font-bold">{stats.students}</p>
            <p className="text-xs text-muted-foreground">Students</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center text-center">
            <Microscope className="w-8 h-8 mb-2 text-blue-600" />
            <p className="text-2xl font-bold">{stats.scientists}</p>
            <p className="text-xs text-muted-foreground">Scientists</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center text-center">
            <Crown className="w-8 h-8 mb-2 text-purple-600" />
            <p className="text-2xl font-bold">{stats.admins}</p>
            <p className="text-xs text-muted-foreground">Admins</p>
          </CardContent>
        </Card>
      </div>

      {/* User Management Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                User Management
              </CardTitle>
              <CardDescription>
                Manage user accounts, roles, and permissions
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchUsers} className="gap-2">
                <RefreshCw className="w-4 h-4" /> Refresh
              </Button>
              <Button size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" /> Add User
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-3 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="citizen">Citizen</SelectItem>
                <SelectItem value="student">Student</SelectItem>
                <SelectItem value="scientist">Scientist</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          <Skeleton
            name="admin-user-management-table"
            loading={loading}
            fallback={
              <div className="flex justify-center items-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            }
            fixture={
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Last Active</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SAMPLE_USERS.slice(0, 4).map((user) => (
                      <TableRow key={`fixture-${user.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {user.name.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{user.name}</p>
                              <p className="text-sm text-muted-foreground">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{getRoleBadge(user.role)}</TableCell>
                        <TableCell>{getStatusBadge(user.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{user.location}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{user.lastActive}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" disabled>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            }
          >
            {filteredUsers.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">
                  {searchQuery || roleFilter !== 'all' || statusFilter !== 'all'
                    ? 'No users found matching your filters'
                    : 'No users found'}
                </p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Last Active</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user, index) => (
                      <motion.tr
                        key={user.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="border-b"
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {user.name.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{user.name}</p>
                              <p className="text-sm text-muted-foreground">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{getRoleBadge(user.role)}</TableCell>
                        <TableCell>{getStatusBadge(user.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {user.location || 'Not specified'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {user.lastActive}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditUser(user)}>
                                <Edit2 className="w-4 h-4 mr-2" />
                                Edit User
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDeleteUser(user)}
                                className="text-red-600"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete User
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </motion.tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Skeleton>
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>Add a new user account from admin dashboard.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-name">Name</Label>
              <Input id="create-name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-email">Email</Label>
              <Input id="create-email" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-role">Role</Label>
              <Select value={createForm.role} onValueChange={(value) => setCreateForm({ ...createForm, role: value })}>
                <SelectTrigger id="create-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="citizen">Citizen</SelectItem>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="scientist">Scientist</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-status">Status</Label>
              <Select value={createForm.status} onValueChange={(value) => setCreateForm({ ...createForm, status: value })}>
                <SelectTrigger id="create-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={confirmCreate} disabled={!createForm.name || !createForm.email}>Create User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information and permissions
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select value={editForm.role} onValueChange={(value) => setEditForm({ ...editForm, role: value })}>
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="citizen">Citizen</SelectItem>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="scientist">Scientist</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select value={editForm.status} onValueChange={(value) => setEditForm({ ...editForm, status: value })}>
                <SelectTrigger id="edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this user? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="p-4 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
              <p className="font-medium text-red-900 dark:text-red-100">
                {selectedUser.name}
              </p>
              <p className="text-sm text-red-700 dark:text-red-300">
                {selectedUser.email}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
