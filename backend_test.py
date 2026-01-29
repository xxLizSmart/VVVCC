#!/usr/bin/env python3
"""
VSteps Backend API Testing Suite
Tests all API endpoints for the VSteps mobile locomotion controller app
"""

import requests
import sys
import json
from datetime import datetime

class VStepsAPITester:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.session = requests.Session()
        
    def log(self, message, status="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {status}: {message}")
        
    def run_test(self, name, method, endpoint, expected_status=200, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        if headers:
            test_headers.update(headers)
            
        self.tests_run += 1
        self.log(f"Testing {name}...")
        
        try:
            if method == 'GET':
                response = self.session.get(url, headers=test_headers)
            elif method == 'POST':
                response = self.session.post(url, json=data, headers=test_headers)
            elif method == 'PUT':
                response = self.session.put(url, json=data, headers=test_headers)
            elif method == 'DELETE':
                response = self.session.delete(url, headers=test_headers)
            else:
                raise ValueError(f"Unsupported method: {method}")
                
            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ {name} - Status: {response.status_code}", "PASS")
                try:
                    return True, response.json()
                except:
                    return True, response.text
            else:
                self.log(f"❌ {name} - Expected {expected_status}, got {response.status_code}", "FAIL")
                try:
                    error_data = response.json()
                    self.log(f"   Error: {error_data}", "FAIL")
                except:
                    self.log(f"   Response: {response.text[:200]}", "FAIL")
                return False, {}
                
        except Exception as e:
            self.log(f"❌ {name} - Exception: {str(e)}", "FAIL")
            return False, {}
    
    def test_basic_endpoints(self):
        """Test basic API endpoints"""
        self.log("=== Testing Basic API Endpoints ===")
        
        # Test online users count
        success, data = self.run_test(
            "Online Users Count",
            "GET", 
            "/api/online-users"
        )
        
        # Test today's leaderboard
        success, data = self.run_test(
            "Today's Leaderboard",
            "GET",
            "/api/leaderboard/today"
        )
        
        # Test all-time leaderboard
        success, data = self.run_test(
            "All-Time Leaderboard", 
            "GET",
            "/api/leaderboard/all-time"
        )
        
    def test_auth_endpoints(self):
        """Test authentication endpoints"""
        self.log("=== Testing Authentication Endpoints ===")
        
        # Test signup with invalid data (should fail)
        success, data = self.run_test(
            "Signup - Missing Fields",
            "POST",
            "/api/auth/signup",
            expected_status=400,
            data={"email": "test@example.com"}
        )
        
        # Test signup with valid data (might fail if user exists, that's ok)
        test_email = f"test_{int(datetime.now().timestamp())}@example.com"
        success, data = self.run_test(
            "Signup - Valid Data",
            "POST", 
            "/api/auth/signup",
            expected_status=200,
            data={
                "email": test_email,
                "password": "testpass123",
                "username": f"testuser_{int(datetime.now().timestamp())}"
            }
        )
        
    def test_user_endpoints(self):
        """Test user-related endpoints"""
        self.log("=== Testing User Endpoints ===")
        
        # Test getting friends for a non-existent user (should return empty or error)
        success, data = self.run_test(
            "Get Friends - Non-existent User",
            "GET",
            "/api/user/non-existent-user-id/friends"
        )
        
    def test_avatar_endpoints(self):
        """Test avatar endpoints"""
        self.log("=== Testing Avatar Endpoints ===")
        
        # Test getting avatar for non-existent user
        success, data = self.run_test(
            "Get Avatar - Non-existent User",
            "GET",
            "/api/avatar/non-existent-user-id",
            expected_status=404
        )
        
    def test_admin_endpoints(self):
        """Test admin endpoints"""
        self.log("=== Testing Admin Endpoints ===")
        
        # Test admin creation with invalid setup key
        success, data = self.run_test(
            "Create Admin - Invalid Key",
            "POST",
            "/api/setup/create-admin",
            expected_status=403,
            data={
                "email": "admin@example.com",
                "password": "adminpass123",
                "username": "testadmin",
                "setupKey": "invalid-key"
            }
        )
        
    def run_all_tests(self):
        """Run all test suites"""
        self.log("🚀 Starting VSteps Backend API Tests")
        self.log(f"Testing against: {self.base_url}")
        
        try:
            self.test_basic_endpoints()
            self.test_auth_endpoints()
            self.test_user_endpoints()
            self.test_avatar_endpoints()
            self.test_admin_endpoints()
            
        except KeyboardInterrupt:
            self.log("Tests interrupted by user", "WARN")
        except Exception as e:
            self.log(f"Unexpected error: {str(e)}", "ERROR")
            
        # Print summary
        self.log("=" * 50)
        self.log(f"📊 Test Summary: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            self.log("🎉 All tests passed!", "SUCCESS")
            return 0
        else:
            failed = self.tests_run - self.tests_passed
            self.log(f"❌ {failed} test(s) failed", "FAIL")
            return 1

def main():
    """Main entry point"""
    base_url = "http://localhost:3000"
    
    # Check if server is reachable
    try:
        response = requests.get(f"{base_url}/api/online-users", timeout=5)
        print(f"✅ Server is reachable at {base_url}")
    except Exception as e:
        print(f"❌ Cannot reach server at {base_url}: {e}")
        return 1
    
    tester = VStepsAPITester(base_url)
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())