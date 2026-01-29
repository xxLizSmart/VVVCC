import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, Profile, AccountType } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Shield, Users, Search, Trash2, UserCog, ArrowLeft, Crown, Clock, Eye } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { apiRequest } from '@/lib/queryClient';

export default function Admin() {
  const { isAdmin, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [users, setUsers] = useState<Profile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (!loading && !isAdmin) {
      setLocation('/');
    }
  }, [isAdmin, loading, setLocation]);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch users.',
        variant: 'destructive',
      });
    } else {
      setUsers(data as Profile[]);
    }
    setIsLoading(false);
  };

  const updateUserType = async (userId: string, newType: AccountType) => {
    try {
      const updates: Partial<Profile> = { account_type: newType };
      
      if (newType === 'DEMO') {
        const trialExpires = new Date();
        trialExpires.setDate(trialExpires.getDate() + 7);
        updates.trial_expires_at = trialExpires.toISOString();
      } else {
        updates.trial_expires_at = null;
      }

      const response = await apiRequest('PATCH', `/api/admin/user/${userId}/type`, updates);
      
      if (!response.ok) {
        throw new Error('Failed to update');
      }

      toast({
        title: 'Success',
        description: 'User account type updated.',
      });
      fetchUsers();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update user type.',
        variant: 'destructive',
      });
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      const response = await apiRequest('DELETE', `/api/admin/user/${userId}`);
      
      if (!response.ok) {
        throw new Error('Failed to delete');
      }

      toast({
        title: 'User Deleted',
        description: 'User and associated data have been removed.',
      });
      fetchUsers();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete user.',
        variant: 'destructive',
      });
    }
  };

  const filteredUsers = users.filter(user =>
    user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getAccountBadge = (type: AccountType) => {
    switch (type) {
      case 'ADMIN':
        return <Badge className="bg-red-500 hover:bg-red-600"><Crown className="w-3 h-3 mr-1" />Admin</Badge>;
      case 'SUBSCRIBED':
        return <Badge className="bg-green-500 hover:bg-green-600"><Crown className="w-3 h-3 mr-1" />Subscribed</Badge>;
      case 'DEMO':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Demo</Badge>;
      case 'BASIC':
        return <Badge variant="outline"><Eye className="w-3 h-3 mr-1" />Basic</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation('/')} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Shield className="w-6 h-6 text-red-500" />
                Admin Panel
              </h1>
              <p className="text-muted-foreground">Manage users and account types</p>
            </div>
          </div>
          <Badge variant="outline" className="text-lg px-4 py-2">
            <Users className="w-4 h-4 mr-2" />
            {users.length} Users
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="w-5 h-5" />
              User Management
            </CardTitle>
            <CardDescription>View, edit, and manage all registered users</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by username or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-users"
                />
              </div>
              <Button onClick={fetchUsers} variant="outline" data-testid="button-refresh">
                Refresh
              </Button>
            </div>

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading users...</div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Account Type</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                        <TableCell className="font-medium">{user.username}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{getAccountBadge(user.account_type)}</TableCell>
                        <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Select
                              value={user.account_type}
                              onValueChange={(value) => updateUserType(user.id, value as AccountType)}
                            >
                              <SelectTrigger className="w-32" data-testid={`select-tier-${user.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="DEMO">Demo</SelectItem>
                                <SelectItem value="BASIC">Basic</SelectItem>
                                <SelectItem value="SUBSCRIBED">Subscribed</SelectItem>
                                <SelectItem value="ADMIN">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="icon" data-testid={`button-delete-${user.id}`}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete User</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete {user.username}? This action cannot be undone and will remove all their data.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteUser(user.id)}>
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
